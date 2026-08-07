# INCEL WORKSPACE PORTAL - USER GUIDE

## Comprehensive Onboarding & Feature Guide

**DOCUMENT VERSION:** 1.0  
**CREATED:** May 2026

## SUMMARY

The Incel Workspace Portal is a centralized digital workspace designed to streamline work management, application access, and organizational operations. It brings everything you need into one secure, unified platform for managing tasks, collaborating on projects, and maintaining control over internal applications.

### KEY BENEFITS

- Centralized task and project management
- Secure access control for internal applications
- Real-time notifications and activity tracking
- Flexible task assignment with recurring schedule support
- Complete audit trail for compliance and accountability
- Role-based access control (RBAC)
- Intuitive, modern user interface

## WHAT IS THE INCEL WORKSPACE PORTAL?

The portal is an enterprise-grade web application serving as the central hub for:

1. **Task management:** Work is organized through a task system allowing you to create, assign, track, and complete work items. Each task has a description, priority level, and deadline.
2. **Application management:** The portal controls access to internal applications and tools. Users can view which applications they have access to and launch them directly.
3. **Recurring task scheduling:** For recurring work that happens regularly (daily/weekly), the system automatically generates task instances according to your defined schedule.
4. **User and access control:** Administrators manage users, departments, roles, and granular access permissions throughout the organization.
5. **Inventory management:** Administrators can catalog company assets and assign them to specific users. Users can view their assigned physical assets.
6. **Audit and compliance:** Every action is logged, creating tasks, changing access, and modifying users, providing a complete audit trail for compliance requirements.
7. **Notifications and collaboration:** Users receive notifications when tasks are assigned, completed, or updated. Comments and activity history keep everyone informed.

## KEY FEATURES OVERVIEW

1. **SECURE AUTHENTICATION**
   - Email and password login with JWT-based secure sessions
   - Automatic session management and password change support

2. **PERSONALIZED DASHBOARD**
   - Quick overview of tasks and responsibilities
   - Role-aware content (different views for admins vs. users)
   - Recent activity summary and quick access buttons

3. **COMPREHENSIVE TASK MANAGEMENT**
   - Create single tasks and assign to team members
   - Three status levels: Pending -> In Progress -> Completed
   - Three priority levels: Low, Medium, High
   - Add descriptions, attach files, view history
   - Collaboration through comments and activity tracking

4. **RECURRING TASK AUTOMATION**
   - Define recurring schedules (daily, weekly) with flexible timing
   - Specify exact times tasks should be created
   - Pause, resume, edit, or end schedules
   - Automatic email notifications for all changes
   - Automatic task creation at scheduled times

5. **APPLICATION ACCESS MANAGEMENT**
   - Browse applications available to you
   - Request access to applications
   - Department-based and role-based access control
   - Quick launch to applications through the portal

6. **INVENTORY & ASSET MANAGEMENT**
   - Centralized catalog of physical company assets
   - Assign items to users and process returns
   - Search and filter by category or status
   - Users have a dedicated view for their personal assigned assets

7. **GOALS & REPORTING**
   - Track performance targets and daily progress
   - Generate automated weekly summaries and organization-level metrics
   - Share progress reports with team members
   - Export summaries to PDF

8. **SUPPORT TICKETING**
   - Create IT support requests directly within the portal
   - Track ticket resolution lifecycle with automated closing
   - Add comments and attachments to tickets

9. **REAL-TIME NOTIFICATIONS**
   - Email notifications for task assignments and completions
   - Updates for recurring schedule changes
   - Web push notifications (where supported)
   - Notification center in the application header

7. **COMPLETE AUDIT LOGGING**
   - Track all system activities and changes
   - View who did what and when
   - Generate compliance reports
   - Historical record of access changes

8. **USER MANAGEMENT (Admin Only)**
   - Create and manage user accounts
   - Assign roles and departments
   - Enable/disable users and reset passwords
   - Manage granular permissions

9. **COLLABORATION FEATURES**
   - Add comments to tasks for team discussion
   - View complete task activity history
   - Attach files and documents
   - See who is working on what

## GETTING STARTED

### STEP 1: LOGGING IN

1. Open your browser and navigate to the workspace portal URL (https://workspace.incelgroup.com)
2. Enter your email address
3. Enter your password (default Incel@123#)
4. Click "Sign In"
5. If you do not have a password or account, meet the IT team to create one for you

### STEP 2: UNDERSTANDING YOUR DASHBOARD

Upon login, you will see:

- Your assigned tasks (created by others, assigned to you)
- Your created tasks (assigned to team members)
- Quick action buttons to major sections
- Recent activity and snapshot panels

### STEP 3: EXPLORE NAVIGATION

The sidebar contains links to:

- Dashboard - Your personalized home screen
- Tasks - View and manage all tasks
- Goals - Track your performance targets
- Reports & Summaries - Submit daily reports and view weekly metrics
- Org Summary - View organization-wide performance
- Applications - Browse available applications
- Support - Request IT assistance and track your tickets
- My Assets - View the physical assets and inventory assigned to you
- Inventory - (Admin only) Manage company assets and process assignments/returns
- Users - View organization members (Admins can also manage them)
- Logs - (Admin only) View audit trail

### STEP 4: UPDATE YOUR PASSWORD (Recommended)

1. Click "Change Password" in the header
2. Enter current password, then new password (minimum 8 characters)
3. Confirm new password and click "Change Password"

### STEP 5: CUSTOMIZE YOUR THEME

Click the sun/moon icon in the top right to switch between light and dark themes.

## MAIN WORKSPACE SECTIONS

### DASHBOARD

Your personal workspace home screen showing:

- Welcome message with your name and role
- Assigned tasks and created tasks summary
- Quick action buttons (View tasks, applications)
- Task snapshot cards with recent activity
- Available applications

### TASKS MANAGEMENT

The Tasks section is where you create, manage, and track work.

**Viewing Tasks:** The task list can be filtered by:

- VIEW: Assigned to Me | Created by Me
- STATUS: Pending, In Progress, Completed
- PRIORITY: Low, Medium, High

**Creating a Task:**

1. Click "Create Task" button
2. Fill in:
   - Title (required)
   - Description (recommended)
   - Assigned To (required)
   - Priority level
   - Deadline (optional)
3. Click "Create Task" - Assignee receives email notification

**Task Details Page:**

- Task title, status, priority, deadline
- Full description and assignee information
- Change Status (only assignee can do this)
- Add Comments for collaboration
- Attach Files (max 10MB per file)
- View complete Activity History

**Task Comments:**

Both creator and assignee can add comments to collaborate. Type your message, optionally attach a file, and click "Post Comment."

**Task Attachments:**

Supported types: Images (PNG, JPG, WebP), PDF, Text, Office documents, ZIP files

- Click "Upload File" in the Attachments section
- Select file(s) from your computer
- File becomes available to task participants
- You can attach up to 5 files per comment

### RECURRING TASKS

For work that repeats on a schedule, the system automatically creates task instances according to your defined schedule.

**Creating a Recurring Task Schedule:**

1. Click on "Create Task"
2. Change the view to "Recurring task"
3. Define:
   - Basic Info: Title, Description, Assign To, Priority
   - Scheduling:
     - Frequency: Daily or Weekly
     - Interval: Every X days/week
     - Weekdays (if weekly): Select Mon, Tue, Wed, etc.
     - Times: What time should tasks be created? (e.g., 09:00, 17:00)
     - Time zone: Choose between Nigerian and Dubai time
     - Start Date: When does this begin?
     - End Date: When should this stop? (optional for indefinite)
4. Click "Create Recurring Schedule" - Assignee notified

**Managing Recurring Schedules:**

For each schedule you can:

- VIEW DETAILS: See all schedule information and next run date
- EDIT SCHEDULE: Update title, description, frequency, times, dates - Assignee receives notification
- PAUSE SCHEDULE: Temporarily stop automatic task creation, can resume later
- RESUME SCHEDULE: Restart automatic task creation after pause
- END SCHEDULE: Permanently stop the recurring task (cannot be undone)

**Automatic Task Creation:**

When a recurring schedule is active at the scheduled time:

- System automatically creates a task instance
- Task is assigned to the designated person
- Email notification sent
- Task appears in "Assigned to Me" view
- Schedule's "Next Run" date updates

### APPLICATIONS

Browse and access internal applications and tools available to you.

**Viewing Applications:**

- Go to the Applications section
- View all applications you have access to
- Each card shows: Name, Logo, Description, Access Status

**Opening an application:**

Click on any application card you have access to - It opens in a new tab/window.

**Admin Features:**

Administrators can create, edit, and manage applications, control access (role-based, department-based, or per-user), and view access history in audit logs.

### INVENTORY & ASSET MANAGEMENT

Manage company physical assets and assignments.

**Viewing Inventory (Admins):**

- Go to the Inventory section
- View all company assets across different categories
- Filter assets by status (e.g. available, assigned, maintenance) or category
- Search for items by name or serial number

**Managing Inventory (Admins):**

- **Create Items**: Add new inventory items, attach a serial number, select a category and purchase date.
- **Assign Items**: Open an item's details and click "Assign" to link the physical asset to a specific user.
- **Process Returns**: When a user returns an item, click "Process Return" to mark it as available again. Condition notes can be added upon return.

**Viewing My Assets (All Users):**

- Click on "My Assets" in the sidebar
- View a dedicated list of all physical assets (laptops, phones, etc.) assigned to you
- Review assignment dates and item details

### GOALS & TARGETS

Set measurable targets and track your personal progress.

**Setting Goals:**
- Navigate to the Goals section
- Define a metric (e.g., tasks completed, files attached)
- Set a target value and select the time period

### REPORTS & SUMMARIES

Maintain a record of your daily work and weekly performance.

**Daily Reports:**
- Go to Reports to submit your daily activities
- Add multiple subreports to break down different pieces of work
- Receive threaded comments on your daily subreports for feedback

**Weekly Summaries:**
- Automatically generated metrics based on your week's activity
- Compare performance week-over-week
- Share your summary with specific users, via public link, or export it to PDF

**Organization Summary:**
- View high-level metrics aggregated across the entire workspace

### SUPPORT TICKETING

Request assistance from the IT Support team or other departments.

**Creating a Ticket:**
- Navigate to the Support section and click "New Request"
- Select a category, priority, and provide a detailed description
- The ticket progresses through lifecycle stages (Open, Assigned, In Progress, Resolved, Closed)

**Managing Tickets:**
- Add comments and file attachments to provide additional context
- Tickets are automatically closed 7 days after being resolved

### USERS AND ADMINISTRATION

Administrators can:

- Create new user accounts with temporary passwords
- Assign roles (Admin, Staff, User, etc.) and departments
- Enable/disable accounts and reset passwords
- View user creation and activity dates
- Create and manage departments
- Define role-based access control
- Set up access control based on departments or individual users

### ACTIVITY LOGS (Admin Only)

Complete audit trail of all system activities including:

- User login/logout events
- Task creation, updates, and completion
- Recurring schedule changes (create, edit, pause, resume, end)
- User access changes
- Application modifications
- Password changes
- All administrative actions

**Filtering Logs:**

Search and filter by date and date range.

## ADVANCED FEATURES

### REAL-TIME NOTIFICATIONS

1. **Notification Center:**

Click the bell icon in the header to open your notification center for:

- New tasks assigned to you
- Tasks you created being completed
- Recurring schedule changes
- Application access changes
- Comments on your tasks

2. **Email Notifications:**

Automatic emails for major events:

- Task assignment
- Task completion
- Recurring schedule changes
- Application access changes
- Password changes (security)

3. **Web Push Notifications:**

If your browser supports them, allow notifications when prompted to receive instant alerts even when not using the portal.

## BEST PRACTICES

### TASK CREATION

**DO:**

- Use clear, descriptive titles
- Include detailed descriptions for complex work
- Attach relevant documents and context
- Set realistic deadlines
- Use appropriate priority levels
- Assign to the right person

**DON'T:**

- Create vague tasks
- Overuse "High" priority
- Assign to wrong person as a workaround
- Create hundreds of similar tasks (use recurring schedules instead)

### RECURRING SCHEDULES

**DO:**

- Use for repetitive work
- Set realistic intervals and times
- Include helpful descriptions
- Use pause/resume rather than creating/deleting repeatedly
- Review periodically to ensure they are still needed

**DON'T:**

- Create with unrealistic frequencies
- Forget to end a schedule when no longer needed
- Use for one-time work (use regular tasks instead)

### NOTIFICATIONS AND COMMUNICATION

**DO:**

- Use task comments for work-related discussions
- Attach documents to keep everything together
- Check notifications/emails regularly

**DON'T:**

- Use comments for casual chat (A chat feature is coming soon just for that)
- Ignore notifications and deadlines
- Create duplicate tasks as reminders

### SECURITY

**DO:**

- Change your password regularly
- Log out on shared computers
- Report suspicious activity
- Keep email address current

**DON'T:**

- Share login credentials
- Use weak passwords
- Leave browser logged in on shared computers

## TROUBLESHOOTING

### Can't log in?

- Verify correct email address
- Check Caps Lock is off
- Reset password with administrator
- Try different browser
- Clear browser cache and cookies

### Tasks are not appearing?

- Check current filter view and status
- Try clearing all filters
- Refresh the page

### Not receiving email notifications?

- Check spam/junk folder
- Verify email address in profile
- Contact administrator

### Can't upload files?

- Verify file size is under 10MB
- Check file type is supported
- Try different file format
- Contact administrator if issue persists

### Recurring schedule is not creating tasks?

- Verify schedule has not been paused
- Check current date has not passed end date
- Verify schedule shows as "Active"
- Check assigned user is active
- Verify you have permission

### Can't access an application?

- Verify you have been granted access
- Check role and department permissions
- Request access if showing "Access Pending"
- Contact administrator if you believe you should have access

## SUPPORT AND CONTACT

For questions, issues, or feature requests, contact the IT team.

### PROVIDE WHEN REPORTING ISSUES

- Your email address
- Specific action or area where issue occurred
- Error message (if any)
- When the issue started
- Browser and browser version
- Screenshots (if helpful)
- Steps to reproduce the issue
