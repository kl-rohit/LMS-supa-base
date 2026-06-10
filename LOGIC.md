# Veena — Business Logic & Rules

The non-obvious decisions we finalized. Implementation-agnostic. Use this when rebuilding so you don't have to re-derive the rules.

---

## 1. Fees

### 1.1 Per-student fee rates
Each student has **three** hourly rates:
- `fee_online` — for online individual classes
- `fee_offline` — for offline individual classes
- `fee_offline_group` — for ALL group classes (online or offline)

There is intentionally **no separate `fee_online_group`** field. The group discount applies regardless of online/offline delivery.

### 1.2 Per-class fee calculation
For every attendance record where status is `present` or `late`:

```
fee_per_hour = student.fee_online              if class_type == 'online'
             | student.fee_offline             if class_type == 'offline'
             | student.fee_offline_group       if class_type in {'offline_group', 'online_group'}

fee_charged  = fee_per_hour × duration_hours
```

- If `status == 'absent'` → `fee_charged = 0`
- The teacher can manually override `fee_charged` on a per-record basis (input is editable in the attendance table)

### 1.3 Class duration
- `duration_hours = (end_time − start_time)` in hours
- Computed at class create/update from start_time and end_time
- **Denormalized** onto every Attendance row so reports stay correct if class times change later
- Default fallback: 1.0 hour if start/end times can't be parsed

### 1.4 Additional (one-off) fees
- Not tied to attendance — flat charges for books, stationery, recital fees, etc.
- Each additional fee has: `student_id, description, amount, fee_date, month, year`
- Bulk creation: one description + one amount creates **one row per selected student** (amount is per-student, not split)

### 1.5 Monthly fee aggregation (Fees page)
For each student in a given month/year:
```
classes_taken          = count(attendance where status in {present, late})
class_fees_total       = sum(attendance.fee_charged) for that student/month
additional_fees_total  = sum(additional_fees.amount) where student_id matches AND month/year matches
grand_total            = class_fees_total + additional_fees_total
```
- Row is **hidden** from the table if both `classes_taken == 0` AND `additional_fees_total == 0`
- Sort: alphabetical by student name

---

## 2. Class types

Four valid values for `class_type`:

| Value | Means | Linked to | Fee rate used |
|-------|-------|-----------|---------------|
| `online` | Individual online class | single student | `fee_online` |
| `offline` | Individual in-person class | single student | `fee_offline` |
| `offline_group` | In-person group class | a Group | `fee_offline_group` |
| `online_group` | Online group class | a Group | `fee_offline_group` |

### Color & icon mapping (UI)
| Type | Border color | Icon (Lucide) |
|------|--------------|---------------|
| online | blue | Monitor |
| offline | emerald (green) | MapPin |
| offline_group | purple | UsersRound |
| online_group | cyan | Wifi |

---

## 3. Multi-student class creation

When creating an **individual** class (online or offline), the teacher can multi-select students.

Decision: **one Classes row + many ClassStudents rows** (M2M). NOT one Classes row per student.

- Editing class time/name updates a single record (all students see the change).
- Deleting the class removes its ClassStudents rows via cascade (handle this manually since Catalyst has no FK cascade).
- For group types, no ClassStudents — link via `group_id` instead.

Frontend UX:
- Checkbox list, search field, Select All, Clear buttons
- Selected students appear as removable chips above the list
- Button label changes to "Create X classes" when multiple selected

---

## 4. Attendance

### 4.1 Day-of-week scheduling
Classes recur weekly by `day_of_week` (0 = Sunday, 6 = Saturday). When the user picks a date in Attendance, show only classes whose `day_of_week` matches `new Date(date).getDay()`.

### 4.2 Marking attendance
- Pick a date → pick a class → see one row per student
- Defaults: `status='present'`, `fee_charged = auto-calculated`, `topic=''`
- Toggling to absent → `fee_charged = 0`
- Toggling back to present → restore the calculated fee
- Manual override of `fee_charged` is allowed (editable input)
- Save sends one bulk POST with all records

### 4.3 Existing-record handling
On loading attendance for a class+date, check if records already exist:
- If yes → preload current values, show trash icons per row, show "Delete All" button
- If no → empty form, "Save" creates fresh records

### 4.4 Absence streak alert
For each active student, count `absent` records starting from the most recent date and going backward without interruption:
```
streak = number of consecutive 'absent' records,
         starting from the most recent attendance,
         stopping when we hit a 'present'/'late' record OR run out of records
```
If `streak ≥ 3`:
- Student appears in the red **Absence Alerts** banner at the top of Attendance + Dashboard
- A red badge `{streak} absent` shows next to their name in the attendance table
- The "Generate Absence Alerts" message button picks them up

### 4.5 Custom attendance (planned, not yet built)
Bypass the class selector entirely:
- Pick a date
- Multi-select students
- Pick class_type and duration manually
- Save without a class link (`class_id = null`)

Requires `class_id` to be nullable on the Attendance table (it is, in the current schema).

---

## 5. Students

### 5.1 Soft-delete
- `DELETE /students/:id` sets `status='inactive'` by default
- `DELETE /students/:id?force=true` hard-deletes the row
- Inactive students are excluded from default Active filter on Students page
- Their attendance/fee history is preserved either way

### 5.2 Bulk inactive cleanup
`DELETE /students/inactive` hard-deletes ALL students with `status='inactive'`. One-click "delete all inactive" action in the UI.

### 5.3 CSV import
Expected headers (case-insensitive):
```
name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, notes
```
- Parsed client-side with papaparse
- Sent as `POST /api/import/students` with `{ rows: [...] }`
- Backend validates each row, inserts what it can, returns `{ imported: count, errors: [...] }`

---

## 6. Messages

### 6.1 Templates (5 of them)
| Type | Trigger | Placeholders |
|------|---------|--------------|
| `fee_reminder` | Manual / Generate Fee Reminders | `{student}`, `{amount}`, `{month}` |
| `absence_alert` | Manual / Generate Absence Alerts | `{student}`, `{count}` |
| `general_reminder` | Manual | `{student}` |
| `class_schedule` | Manual | `{student}`, `{day}`, `{time}` |
| `custom` | Manual | none — freeform |

### 6.2 Auto-generation
- **Generate Absence Alerts** → loop over students with `streak ≥ 3`, create one draft message each, return `{ created: count }`
- **Generate Fee Reminders** → loop over students with outstanding fees this month (i.e. monthly aggregation `grand_total > 0`), create one draft each

Both create messages with `is_sent = 0`. The teacher reviews and sends them.

### 6.3 Sending
There's no SMS/email integration. "Send" is just a deep-link:
```
https://wa.me/<mobile_number>?text=<encodeURIComponent(message)>
```
Opens WhatsApp in a new tab. The teacher manually clicks send.

After visiting the link, the teacher can toggle `is_sent = 1` in the UI.

### 6.4 Message history
Filter by: status (sent/draft), message_type, student. Bulk delete, individual delete.

---

## 7. Dashboard stats

Single `GET /api/dashboard` returns:

```
stats: {
  total_students       = count(Students where status = 'active')
  classes_today        = count(Classes where day_of_week = today AND is_active = 1)
  attendance_rate      = count(Attendance this month where status='present')
                         / count(Attendance this month where status in {present, absent})
                         × 100
                       (returns 0 if denominator is 0)
  fees_collected       = sum of monthly grand_totals for current month
}
today_classes:    list of today's classes with student/group info
recent_attendance: last 5 attendance records across all students
alerts:           students with streak >= 3 (same as Absence Alerts banner)
```

---

## 8. Zoho Sheets sync (optional integration)

### 8.1 Configuration storage
All Zoho credentials live in the **Settings** Data Store table (NOT environment variables). Why: the teacher can reconfigure through the UI without redeploying.

Keys in Settings:
- `zoho_client_id`, `zoho_client_secret`, `zoho_refresh_token`, `zoho_region` (com/in/eu/au)
- `zoho_access_token`, `zoho_token_expiry` (auto-managed cache)
- `zoho_spreadsheet_id` (set after "Create Spreadsheet" action)
- `zoho_last_sync` (ISO timestamp)
- `zoho_auto_sync` ('true'/'false')

### 8.2 OAuth token lifecycle
- Refresh token is long-lived
- Access token is short-lived (~1 hour)
- Cache the access token in `zoho_access_token`/`zoho_token_expiry`
- Refresh 5 minutes before expiry (preemptive — avoids race conditions)

### 8.3 Spreadsheet structure
One workbook with **6 tabs**:

| Tab | Source DB table | Notes |
|-----|----------------|-------|
| Students | Students | Direct 1:1 |
| Groups | Groups + GroupStudents | Denormalize members into `member_names` (comma-separated) + `member_count` columns |
| Classes | Classes + ClassStudents | Denormalize students into a comma-separated column |
| Attendance | Attendance | Add `student_name`, `class_name` lookups |
| Fees | AdditionalFees | Direct |
| Messages | Messages | Direct |

### 8.4 Fire-and-forget sync hooks
Every mutation route (CREATE/UPDATE/DELETE on the 6 syncable resources) calls a sync helper **after** the DB write succeeds. The helper:

1. Checks `isZohoEnabled()` — returns immediately if not configured
2. Wraps the work in `(async () => { ... })().catch(logError)` so the route's HTTP response goes out without waiting
3. Translates the DB row through `mapRow()` for the appropriate sheet tab
4. Appends/updates/deletes the matching row in the Sheet

Failures are logged but never propagated to the API caller.

### 8.5 Full re-sync
`POST /api/settings/zoho/sync-all`:
1. Clear all 6 sheet tabs (keep headers)
2. Re-push all DB rows in batches of 200
3. Return `{ results: { Students: count, Groups: count, ... } }`

---

## 9. Auth / access control

**There is no end-user authentication.** Single user (the teacher).

Access control is entirely via:
- Catalyst project domain (URL is not publicly discoverable)
- Catalyst's project-level OAuth (admin scope on every backend call)

If you ever add multi-tenancy, you'll need to:
- Add a `users` table
- Switch Catalyst SDK init from `scope: 'admin'` to `scope: 'user'`
- Add `user_id` foreign key to every other table
- Filter every query by `user_id`

---

## 10. Validation rules (per resource)

### Students
- `name`, `parent_name`, `mobile_number` are mandatory
- All 3 fees default to 0
- `status` defaults to 'active'
- Mobile number stored as-is (no formatting/validation — Indian numbers but no enforcement)

### Groups
- `name` is mandatory and unique
- `description` optional

### Classes
- `name`, `class_type`, `day_of_week`, `start_time`, `end_time` mandatory
- `class_type` must be one of the 4 valid values
- `day_of_week` must be 0–6
- For group types: `group_id` mandatory
- For individual types: at least one student (`student_id` or `student_ids[]`) required
- `start_time` < `end_time` (else duration = 1 fallback)

### Attendance
- `student_id`, `date`, `status` mandatory
- `class_id` nullable (for custom/adhoc attendance)
- `status` must be `present` | `absent` | `late`
- `date` is YYYY-MM-DD string

### Additional Fees
- `student_ids[]` (or `student_id`), `description`, `amount`, `fee_date`, `month`, `year` mandatory
- `amount` is per student (not split)
- `month` 1–12, `year` 4-digit

### Messages
- `message` mandatory
- Either `student_id` set (and `parent_name`/`mobile_number` will be denormalized from Students) OR all three of `parent_name`/`mobile_number` set manually
- `message_type` defaults to 'custom'
- `is_sent` is 0 or 1 (Integer, not Boolean)

---

## 11. Time/date conventions

- All date columns store **`YYYY-MM-DD` as Text** (not native Date type)
- Time columns store **`HH:MM` as Text** (24-hour)
- The teacher is in India (IST). The app does NOT timezone-convert anywhere
- `created_at`, `updated_at` use Catalyst's auto-managed `CREATEDTIME`/`MODIFIEDTIME` system columns
- Day of week is **0 = Sunday** through **6 = Saturday** (matches JS `Date.getDay()`)

---

## 12. Sort orders (UI conventions)

| Resource | Default sort |
|----------|--------------|
| Students | name ASC |
| Groups | name ASC |
| Classes (within a day) | start_time ASC |
| Attendance | date DESC |
| Fees (monthly view) | student_name ASC |
| Messages | created_at DESC |

---

## 13. Things that look like bugs but aren't

| Behavior | Why |
|----------|-----|
| Online_group uses fee_offline_group (no fee_online_group field) | Intentional — group rate is a discount that applies regardless of delivery mode |
| duration_hours stored on Attendance even though it's derivable | Denormalized so historical fees stay correct if class times change later |
| status=absent stores fee_charged=0 instead of NULL | Simpler aggregation (SUM works without COALESCE) |
| Soft-deleted students still appear in old attendance records | Historical integrity — past fees shouldn't disappear |
| No transactions wrapping multi-row inserts | Catalyst Data Store doesn't support them. Document partial-failure risk in route comments |
| Zoho sync errors don't fail the API call | Fire-and-forget by design — sync is best-effort, not critical-path |
| Manual fee override on Attendance row sticks even if class fee changes | Once attendance is recorded, the fee is "frozen" at that value |
