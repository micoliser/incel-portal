"""Small helpers for working with user accounts."""


def display_name(user) -> str:
    """A person's full name, falling back to their username when no name is set."""
    return user.get_full_name() or user.username
