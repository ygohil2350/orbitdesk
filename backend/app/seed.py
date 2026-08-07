import asyncio

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Comment, Organization, Priority, Project, Role, Task, TaskStatus, User


async def seed() -> None:
    async with SessionLocal() as session:
        superuser = await session.scalar(select(User).where(User.role == Role.SUPERUSER))
        if not superuser:
            session.add(
                User(
                    email="super@orbitdesk.demo",
                    full_name="System Super User",
                    password_hash=hash_password("SuperDemo123!"),
                    role=Role.SUPERUSER,
                )
            )

        organization = await session.scalar(
            select(Organization).where(Organization.slug == "northstar-labs")
        )
        if not organization:
            organization = Organization(name="Northstar Labs", slug="northstar-labs")
            session.add(organization)
            await session.flush()

        existing_users = {
            u.email: u
            for u in (
                await session.scalars(select(User).where(User.organization_id == organization.id))
            ).all()
        }
        user_specs = [
            ("admin@northstar.demo", "Maya Chen", Role.ORG_ADMIN, "AdminDemo123!"),
            ("dev@northstar.demo", "Jon Bell", Role.MEMBER, "MemberDemo123!"),
            ("member@northstar.demo", "Priya Shah", Role.MEMBER, "MemberDemo123!"),
        ]
        for email, name, role, password in user_specs:
            if email not in existing_users:
                user = User(
                    organization_id=organization.id,
                    email=email,
                    full_name=name,
                    password_hash=hash_password(password),
                    role=role,
                )
                session.add(user)
                existing_users[email] = user
        await session.flush()

        project = await session.scalar(
            select(Project).where(Project.organization_id == organization.id, Project.key == "ORB")
        )
        if not project:
            project = Project(
                organization_id=organization.id,
                name="Orbit Mobile",
                key="ORB",
                description="A focused launch workspace for the Orbit mobile experience.",
            )
            session.add(project)
            await session.flush()

        task_exists = await session.scalar(
            select(Task.id).where(Task.project_id == project.id).limit(1)
        )
        if not task_exists:
            admin, dev, member = (
                existing_users["admin@northstar.demo"],
                existing_users["dev@northstar.demo"],
                existing_users["member@northstar.demo"],
            )
            specs = [
                (
                    1,
                    "Finalize onboarding empty states",
                    TaskStatus.TODO,
                    Priority.HIGH,
                    member,
                    "Design and implement the three empty states shown during "
                    "first-run onboarding.",
                ),
                (
                    2,
                    "Instrument activation funnel",
                    TaskStatus.TODO,
                    Priority.MEDIUM,
                    dev,
                    "Add events for account creation, workspace setup, invite, "
                    "and first completed task.",
                ),
                (
                    3,
                    "Build notification preferences",
                    TaskStatus.IN_PROGRESS,
                    Priority.HIGH,
                    dev,
                    "Create per-channel notification controls with sensible defaults.",
                ),
                (
                    4,
                    "Accessibility pass on task drawer",
                    TaskStatus.IN_PROGRESS,
                    Priority.URGENT,
                    member,
                    "Audit keyboard flow, focus management, contrast, and screen-reader labels.",
                ),
                (
                    5,
                    "Ship responsive board navigation",
                    TaskStatus.DONE,
                    Priority.MEDIUM,
                    dev,
                    "Support the compact navigation pattern from 320px through desktop.",
                ),
                (
                    6,
                    "Document release rollback plan",
                    TaskStatus.DONE,
                    Priority.LOW,
                    admin,
                    "Capture signals, owners, thresholds, and the rollback sequence.",
                ),
            ]
            created: list[Task] = []
            for sequence, title, state, priority, assignee, description in specs:
                task = Task(
                    organization_id=organization.id,
                    project_id=project.id,
                    sequence=sequence,
                    title=title,
                    description=description,
                    status=state,
                    priority=priority,
                    assignee_id=assignee.id,
                    reporter_id=admin.id,
                )
                session.add(task)
                created.append(task)
            await session.flush()
            session.add_all(
                [
                    Comment(
                        organization_id=organization.id,
                        task_id=created[2].id,
                        author_id=admin.id,
                        body="Let's keep the first version focused on email and in-app controls.",
                    ),
                    Comment(
                        organization_id=organization.id,
                        task_id=created[2].id,
                        author_id=dev.id,
                        body="Core UI is in place. I'm connecting saved preferences today.",
                    ),
                    Comment(
                        organization_id=organization.id,
                        task_id=created[3].id,
                        author_id=member.id,
                        body=(
                            "Keyboard audit is complete; focus return from the drawer "
                            "is the last issue."
                        ),
                    ),
                ]
            )
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
