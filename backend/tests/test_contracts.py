import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models import TaskStatus
from app.schemas import FileValidation, OrgProvisionRequest, TaskCreate, TaskUpdate
from app.services.tasks import validate_transition


def test_organization_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        OrgProvisionRequest.model_validate(
            {
                "name": "Acme",
                "slug": "acme",
                "admin_email": "admin@acme.test",
                "admin_name": "Admin",
                "admin_password": "LongPassword1!",
                "organization_id": "injected",
            }
        )


def test_task_rejects_non_uuid_assignee() -> None:
    with pytest.raises(ValidationError):
        TaskCreate.model_validate(
            {
                "project_id": "not-an-id",
                "title": "Valid title",
                "assignee_id": "also-not-an-id",
                "priority": "medium",
            }
        )


def test_task_update_requires_a_real_change() -> None:
    with pytest.raises(ValidationError):
        TaskUpdate.model_validate({})

    update = TaskUpdate.model_validate({"title": "Updated task title"})
    assert update.title == "Updated task title"

    assignee_id = uuid.uuid4()
    reassignment = TaskUpdate.model_validate({"assignee_id": str(assignee_id)})
    assert reassignment.assignee_id == assignee_id

    priority_change = TaskUpdate.model_validate({"priority": "urgent"})
    assert priority_change.priority.value == "urgent"


def test_workflow_blocks_skipping_to_done() -> None:
    with pytest.raises(HTTPException):
        validate_transition(TaskStatus.TODO, TaskStatus.DONE)


def test_workflow_allows_forward_and_reopen() -> None:
    validate_transition(TaskStatus.TODO, TaskStatus.IN_PROGRESS)
    validate_transition(TaskStatus.IN_PROGRESS, TaskStatus.DONE)
    validate_transition(TaskStatus.DONE, TaskStatus.IN_PROGRESS)


@pytest.mark.parametrize("bad_name", ["", "../secret.txt", "a" * 256])
def test_file_name_validation(bad_name: str) -> None:
    if bad_name == "../secret.txt":
        assert FileValidation.clean_name(bad_name) == "_secret.txt"
    else:
        with pytest.raises(ValueError):
            FileValidation.clean_name(bad_name)
