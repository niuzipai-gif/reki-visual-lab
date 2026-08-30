import json

import httpx
import pytest

from app.config import Settings
from app.domain.models import EditPlan
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
    source_url = "https://assets.example.test/tasks/task-1/original/look.png?signature=old"
    plan = EditPlan()

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
    plan = EditPlan()

    job = provider.submit_edit("https://assets.example.test/original.png", plan)
    result = provider.poll(job.job_id)
    payload = json.loads(requests[0].content)

    assert requests[0].url.path == "/v1/edit"
    assert requests[0].headers["authorization"] == f"Bearer {secret}"
    assert payload["model"] == "retouch-v3"
    assert payload["source_url"] == "https://assets.example.test/original.png"
    assert payload["plan"] == plan.model_dump(mode="json")
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
