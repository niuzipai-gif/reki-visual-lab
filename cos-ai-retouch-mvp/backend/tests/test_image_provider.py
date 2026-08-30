import inspect
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Lock

import httpx
import pytest

from app.config import Settings
from app.domain.models import AssetURL, EditPlan, Goal, MaskStroke, Operation
from app.services.image_provider import (
    ExternalImageModelProvider,
    MockImageModelProvider,
    ProviderError,
)


def test_mock_provider_returns_the_fixed_analysis_fixture():
    provider = MockImageModelProvider()

    job = provider.submit_analysis("https://assets.example.test/original.png")
    result = provider.poll(job.job_id)

    assert job.operation == "analysis"
    assert job.status == "queued"
    assert result.status == "succeeded"
    assert result.analysis
    assert result.analysis[0].id == "card-face-1"
    assert result.analysis[0].enabled is False


def test_mock_edit_submission_is_idempotent_and_marks_the_demo_copy_asset():
    provider = MockImageModelProvider()
    source_url = (
        "https://assets.example.test/tasks/task-1/original/look.png?signature=old"
    )
    plan = EditPlan(
        mask_strokes=(
            MaskStroke(
                mode="erase",
                width=12,
                points=({"x": 0.2, "y": 0.3},),
            ),
        )
    )

    first = provider.submit_edit(source_url, plan)
    retry = provider.submit_edit(
        source_url.replace("signature=old", "signature=new"),
        plan,
    )
    result = provider.poll(first.job_id)

    assert retry.job_id == first.job_id
    assert len(provider.jobs) == 1
    assert result.asset_url is not None
    assert result.asset_url.kind == "version"
    assert result.asset_url.url != source_url
    assert "provider=mock" in result.asset_url.url
    assert result.metadata["provider"] == "mock"
    assert result.metadata["label"] == "演示模型结果"


def test_external_provider_sends_a_structured_plan_and_normalizes_jobs():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(202, json={"id": "job-42", "status": "queued"})
        return httpx.Response(
            200,
            json={
                "job_id": "job-42",
                "status": "succeeded",
                "asset_url": "https://provider.example.test/results/job-42.png",
                "metadata": {"provider_request_id": "req-42"},
            },
        )

    secret = "server-only-secret"
    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key=secret,
        image_provider_model="retouch-v3",
    )
    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = ExternalImageModelProvider(settings, http_client=client)
    plan = EditPlan(
        mask_strokes=(
            MaskStroke(
                mode="erase",
                width=12,
                points=({"x": 0.2, "y": 0.3},),
            ),
        )
    )

    job = provider.submit_edit("https://assets.example.test/original.png", plan)
    result = provider.poll(job.job_id)
    payload = json.loads(requests[0].content)

    assert requests[0].url.path == "/v1/edit"
    assert requests[0].headers["authorization"] == f"Bearer {secret}"
    assert payload["model"] == "retouch-v3"
    assert payload["source_url"] == "https://assets.example.test/original.png"
    assert payload["plan"] == plan.model_dump(mode="json")
    assert payload["plan"]["mask_strokes"] == [
        {"mode": "erase", "width": 12.0, "points": [{"x": 0.2, "y": 0.3}]}
    ]
    assert "prompt" not in payload
    assert job.job_id == "job-42"
    assert job.status == "queued"
    assert result.job_id == "job-42"
    assert result.asset_url.url.endswith("job-42.png")
    assert result.metadata == {"provider_request_id": "req-42"}


def test_external_provider_reuses_a_job_for_the_same_operation():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(202, json={"job_id": "job-once", "status": "queued"})

    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(
        settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    plan = EditPlan()

    first = provider.submit_edit(
        "https://assets.example.test/original.png?signature=one", plan
    )
    retry = provider.submit_edit(
        "https://assets.example.test/original.png?signature=two", plan
    )

    assert first.job_id == retry.job_id == "job-once"
    assert len(calls) == 1
    assert calls[0].headers["idempotency-key"]


def test_external_provider_redacts_non_2xx_upstream_body_and_secrets():
    upstream_body = "upstream stack with server-only-secret and customer prompt"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text=upstream_body)

    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(
        settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(ProviderError) as raised:
        provider.submit_analysis("https://assets.example.test/original.png")

    message = str(raised.value)
    assert raised.value.code == "UPSTREAM_ERROR"
    assert "server-only-secret" not in message
    assert "upstream stack" not in message
    assert "customer prompt" not in message


@pytest.mark.parametrize(
    "asset_url",
    [
        "data:image/png;base64,ZmFrZQ==",
        "file:///tmp/result.png",
        "javascript:alert(1)",
        "https:///missing-host/result.png",
        "https://user:password@provider.example.test/result.png",
    ],
)
def test_external_provider_rejects_unsafe_result_asset_urls(asset_url):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"job_id": "job-asset", "status": "succeeded", "asset_url": asset_url},
        )

    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(
        settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(ProviderError) as raised:
        provider.poll("job-asset")

    assert raised.value.code == "INVALID_PROVIDER_RESPONSE"


def test_external_provider_uses_settings_ttl_for_result_asset_urls():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "job_id": "job-expiry",
                "status": "succeeded",
                "asset_url": "https://provider.example.test/result.png",
            },
        )

    settings = Settings(
        asset_ttl_hours=3,
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(
        settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    before = datetime.now(timezone.utc) + timedelta(hours=3)

    result = provider.poll("job-expiry")

    after = datetime.now(timezone.utc) + timedelta(hours=3)
    assert before <= result.asset_url.expires_at <= after


def test_external_provider_downloads_png_result_bytes_without_forwarding_provider_auth():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            content=b"generated-png",
            headers={"content-type": "image/png"},
        )

    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(
        settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    asset = AssetURL(
        kind="version",
        url="https://provider.example.test/results/job-42.png",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    body, content_type = provider.download_result(asset)

    assert body == b"generated-png"
    assert content_type == "image/png"
    assert requests[0].method == "GET"
    assert "authorization" not in requests[0].headers


def test_external_provider_canonicalizes_equivalent_plans_without_operation_ids():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            202, json={"job_id": "job-equivalent", "status": "queued"}
        )

    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(
        settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    first_plan = EditPlan(
        operations=(Operation(kind="skin_retouch", goal=Goal.NATURAL_RETOUCH),)
    )
    equivalent_plan = EditPlan(
        operations=(Operation(kind="skin_retouch", goal=Goal.NATURAL_RETOUCH),)
    )

    first = provider.submit_edit("https://assets.example.test/original.png", first_plan)
    retry = provider.submit_edit(
        "https://assets.example.test/original.png",
        equivalent_plan,
    )

    assert first.job_id == retry.job_id == "job-equivalent"
    assert len(calls) == 1


def test_external_provider_serializes_concurrent_same_operation_to_one_submission():
    calls = 0
    calls_lock = Lock()

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        with calls_lock:
            calls += 1
        time.sleep(0.05)
        return httpx.Response(
            202, json={"job_id": "job-concurrent", "status": "queued"}
        )

    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(
        settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    plan = EditPlan()

    with ThreadPoolExecutor(max_workers=8) as executor:
        jobs = list(
            executor.map(
                lambda _: provider.submit_edit(
                    "https://assets.example.test/original.png", plan
                ),
                range(8),
            )
        )

    assert {job.job_id for job in jobs} == {"job-concurrent"}
    assert calls == 1


class _InvalidJsonUrllibResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return b"not-json"


def test_urllib_fallback_maps_successful_invalid_json_to_invalid_provider_response(
    monkeypatch,
):
    monkeypatch.setattr(
        "app.services.image_provider.urlopen",
        lambda request, timeout: _InvalidJsonUrllibResponse(),
    )
    settings = Settings(
        image_provider_mode="external",
        image_provider_base_url="https://provider.example.test/v1",
        image_provider_api_key="server-only-secret",
    )
    provider = ExternalImageModelProvider(settings)

    with pytest.raises(ProviderError) as raised:
        provider.submit_analysis("https://assets.example.test/original.png")

    assert raised.value.code == "INVALID_PROVIDER_RESPONSE"


def test_external_provider_close_closes_an_injected_http_client():
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                202, json={"job_id": "job", "status": "queued"}
            )
        )
    )
    provider = ExternalImageModelProvider(
        Settings(
            image_provider_mode="external",
            image_provider_base_url="https://provider.example.test/v1",
            image_provider_api_key="server-only-secret",
        ),
        http_client=client,
    )

    provider.close()
    provider.close()

    assert client.is_closed


def test_provider_submit_boundary_never_accepts_a_frontend_api_key():
    providers = (
        MockImageModelProvider(),
        ExternalImageModelProvider(Settings()),
    )

    for provider in providers:
        for method_name in ("submit_analysis", "submit_edit"):
            parameters = inspect.signature(
                getattr(provider, method_name)
            ).parameters.values()
            assert "api_key" not in {parameter.name for parameter in parameters}
            assert not any(
                parameter.kind is inspect.Parameter.VAR_KEYWORD
                for parameter in parameters
            )

        with pytest.raises(TypeError):
            provider.submit_analysis(
                "https://assets.example.test/original.png",
                api_key="frontend-secret",
            )
        with pytest.raises(TypeError):
            provider.submit_edit(
                "https://assets.example.test/original.png",
                EditPlan(),
                api_key="frontend-secret",
            )
