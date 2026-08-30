from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.repositories.tasks import TaskRepository


@pytest.fixture
def db_engine(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def db_session(db_engine) -> Iterator[Session]:
    with Session(db_engine) as session:
        yield session


@pytest.fixture
def repository(db_session: Session) -> TaskRepository:
    return TaskRepository(db_session)
