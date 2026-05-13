from django.contrib.auth.models import User

from applications.models import InternalApplication
from organization.models import Department, Role

def _clean_text(value, fallback='-'):
    if value is None:
        return fallback
    text = str(value).strip()
    return text if text else fallback


def _to_bool(value):
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return text in {'1', 'true', 'yes', 'y', 'on'}


def _humanize_token(value):
    text = _clean_text(value, fallback='')
    if not text:
        return ''
    return text.replace('_', ' ').strip().title()


def _lookup_user_email(user_id):
    if not user_id:
        return None

    user = User.objects.filter(id=user_id).only('email').first()
    return user.email if user else None


def _lookup_role_name(role_id, role_code=None):
    if role_id:
        role = Role.objects.filter(id=role_id).only('name').first()
        if role:
            return role.name

    if role_code:
        role = Role.objects.filter(code=role_code).only('name').first()
        if role:
            return role.name

    return _clean_text(role_code, fallback='Unknown role')


def _lookup_department_name(department_id):
    if not department_id:
        return None

    department = Department.objects.filter(id=department_id).only('name').first()
    return department.name if department else None


def _lookup_application_name(application_id):
    if not application_id:
        return None

    application = InternalApplication.objects.filter(id=application_id).only('name').first()
    return application.name if application else None


def _resolve_application_name(payload, target_type, target_id):
    from_payload = payload.get('application_name')
    if from_payload:
        return _clean_text(from_payload, fallback='this application')

    from_payload_id = _lookup_application_name(payload.get('application_id'))
    if from_payload_id:
        return from_payload_id

    target_type_text = _clean_text(target_type, fallback='').lower()
    if target_type_text in {'internalapplication', 'internal_application'} and target_id:
        from_target = _lookup_application_name(target_id)
        if from_target:
            return from_target

    return 'this application'


def action_label(action):
    labels = {
        'APPLICATION_OPEN_GRANTED': 'Application Opened',
        'APPLICATION_OPEN_DENIED': 'Application Access Denied',
        'ADMIN_APPLICATION_CREATED': 'Application Created',
        'ADMIN_APPLICATION_UPDATED': 'Application Updated',
        'ADMIN_APPLICATION_SOFT_DELETED': 'Application Deleted',
        'ADMIN_APPLICATION_DEPARTMENTS_UPDATED': 'Application Departments Updated',
        'ADMIN_APPLICATION_OVERRIDE_UPSERTED': 'Application Access Override Updated',
        'ADMIN_APPLICATION_OVERRIDE_DELETED': 'Application Access Override Deleted',
        'AUTH_LOGIN_FAILED': 'Login Failed',
        'AUTH_LOGIN_SUCCESS': 'Login Succeeded',
        'AUTH_LOGOUT': 'Logged Out',
        'AUTH_PASSWORD_CHANGE_FAILED': 'Password Change Failed',
        'AUTH_PASSWORD_CHANGED': 'Password Changed',
        'ADMIN_USER_CREATED': 'User Created',
        'ADMIN_USER_PASSWORD_RESET': 'User Password Reset',
        'ADMIN_USER_UPDATED': 'User Updated',
        'ADMIN_USER_ROLE_UPDATED': 'User Role Updated',
        'ADMIN_USER_DEPARTMENT_UPDATED': 'User Department Updated',
        'ADMIN_USER_STATUS_UPDATED': 'User Status Updated',
        'TASK_CREATED': 'Task Created',
        'TASK_STATUS_CHANGED': 'Task Status Changed',
        'TASK_RECURRING_SCHEDULE_CREATED': 'Recurring Task Schedule Created',
        'TASK_RECURRING_SCHEDULE_UPDATED': 'Recurring Task Schedule Updated',
        'TASK_RECURRING_SCHEDULE_ENDED': 'Recurring Task Schedule Ended',
        'TASK_RECURRING_SCHEDULE_PAUSED': 'Recurring Task Schedule Paused',
        'TASK_RECURRING_SCHEDULE_RESUMED': 'Recurring Task Schedule Resumed',
    }
    if action in labels:
        return labels[action]
    return _humanize_token(action) or 'Activity Logged'


def target_label(target_type, target_id):
    target = _humanize_token(target_type)
    if not target and target_id:
        return f'Object ({target_id})'
    if not target:
        return 'System'
    if target_id:
        return f'{target} ({target_id})'
    return target


def build_message(action, metadata, target_type='', target_id=''):
    payload = metadata if isinstance(metadata, dict) else {}

    email = _clean_text(payload.get('email'), fallback='this account')
    application_name = _resolve_application_name(payload, target_type, target_id)
    reason = _clean_text(payload.get('reason'), fallback='')
    title = _clean_text(payload.get('title'), fallback='this task')
    user_email = _clean_text(
        payload.get('user_email') or _lookup_user_email(payload.get('user_id')),
        fallback='this user',
    )
    role_name = _clean_text(
        payload.get('role_name') or _lookup_role_name(payload.get('role_id'), payload.get('role_code')),
        fallback='Unknown role',
    )
    department_name = _clean_text(
        payload.get('department_name') or _lookup_department_name(payload.get('department_id')),
        fallback='Unknown department',
    )

    if action == 'AUTH_LOGIN_FAILED':
        if reason == 'disabled_account':
            return f'Login failed for {email} because the account is disabled.'
        return f'Login failed for {email}.'

    if action == 'AUTH_LOGIN_SUCCESS':
        return 'User logged in successfully.'

    if action == 'AUTH_LOGOUT':
        return 'User logged out.'

    if action == 'AUTH_PASSWORD_CHANGE_FAILED':
        if reason == 'incorrect_old_password':
            return 'Password change failed because the old password was incorrect.'
        return 'Password change failed.'

    if action == 'AUTH_PASSWORD_CHANGED':
        return 'Password was changed successfully.'

    if action == 'ADMIN_USER_CREATED':
        return f'Admin created user {email} with role {role_name} in department {department_name}.'

    if action == 'ADMIN_USER_PASSWORD_RESET':
        return f'Admin reset the password for {email}.'

    if action == 'ADMIN_USER_UPDATED':
        return f'Admin updated user {email}.'

    if action == 'ADMIN_USER_ROLE_UPDATED':
        return f'Admin changed a user role to {role_name}.'

    if action == 'ADMIN_USER_DEPARTMENT_UPDATED':
        return f'Admin changed a user department to {department_name}.'

    if action == 'ADMIN_USER_STATUS_UPDATED':
        status_value = 'enabled' if _to_bool(payload.get('is_active')) else 'disabled'
        return f'Admin {status_value} user account {email}.'

    if action == 'APPLICATION_OPEN_GRANTED':
        reason_text = f' Reason: {reason}.' if reason else ''
        return f'Application access was granted.{reason_text}'

    if action == 'APPLICATION_OPEN_DENIED':
        reason_text = f' Reason: {reason}.' if reason else ''
        return f'Application access was denied.{reason_text}'

    if action == 'ADMIN_APPLICATION_CREATED':
        return f'Admin created application {application_name}.'

    if action == 'ADMIN_APPLICATION_UPDATED':
        return f'Admin updated application {application_name}.'

    if action == 'ADMIN_APPLICATION_SOFT_DELETED':
        return 'Admin deleted an application.'

    if action == 'ADMIN_APPLICATION_DEPARTMENTS_UPDATED':
        return 'Admin updated application department access.'

    if action == 'ADMIN_APPLICATION_OVERRIDE_UPSERTED':
        effect = _clean_text(payload.get('effect'), fallback='')
        if effect.upper() == 'ALLOW':
            return f'Admin granted access to {application_name} for {user_email}.'
        if effect.upper() == 'DENY':
            return f'Admin denied access to {application_name} for {user_email}.'
        return f'Admin updated access override for {user_email} on {application_name}.'

    if action == 'ADMIN_APPLICATION_OVERRIDE_DELETED':
        return 'Admin removed an application override.'

    if action == 'TASK_CREATED':
        priority = _clean_text(payload.get('priority'), fallback='unspecified')
        return f'Task "{title}" was created with {priority} priority.'

    if action == 'TASK_STATUS_CHANGED':
        old_status = _humanize_token(payload.get('old_status')) or 'Unknown'
        new_status = _humanize_token(payload.get('new_status')) or 'Unknown'
        return f'Task status changed from {old_status} to {new_status}.'

    if action == 'TASK_RECURRING_SCHEDULE_CREATED':
        return f'Recurring schedule for task "{title}" was created.'

    if action == 'TASK_RECURRING_SCHEDULE_UPDATED':
        return f'Recurring schedule for task "{title}" was updated.'

    if action == 'TASK_RECURRING_SCHEDULE_ENDED':
        return f'Recurring schedule for task "{title}" was ended.'

    if action == 'TASK_RECURRING_SCHEDULE_PAUSED':
        return f'Recurring schedule for task "{title}" was paused.'

    if action == 'TASK_RECURRING_SCHEDULE_RESUMED':
        return f'Recurring schedule for task "{title}" was resumed.'

    label = action_label(action)
    target = target_label(target_type, target_id)
    return f'{label} on {target}.'
