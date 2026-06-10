const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SHEET_MAPPINGS = {
  Students: {
    sheetName: 'Students',
    columns: ['id', 'name', 'parent_name', 'mobile_number', 'fee_online', 'fee_offline', 'fee_offline_group', 'status', 'notes', 'created_at', 'updated_at'],
    mapRow: (s) => ({
      id: s.id,
      name: s.name || '',
      parent_name: s.parent_name || '',
      mobile_number: s.mobile_number || '',
      fee_online: s.fee_online || 0,
      fee_offline: s.fee_offline || 0,
      fee_offline_group: s.fee_offline_group || 0,
      status: s.status || 'active',
      notes: s.notes || '',
      created_at: s.created_at || '',
      updated_at: s.updated_at || '',
    }),
  },

  Groups: {
    sheetName: 'Groups',
    columns: ['id', 'name', 'description', 'member_count', 'member_names', 'created_at'],
    mapRow: (group, members) => ({
      id: group.id,
      name: group.name || '',
      description: group.description || '',
      member_count: members ? members.length : 0,
      member_names: members ? members.map((m) => m.name || m.student_name).join(', ') : '',
      created_at: group.created_at || '',
    }),
  },

  Classes: {
    sheetName: 'Classes',
    columns: ['id', 'name', 'student_name', 'group_name', 'class_type', 'day', 'start_time', 'end_time', 'duration_hours', 'is_active', 'created_at'],
    mapRow: (cls) => ({
      id: cls.id,
      name: cls.name || '',
      student_name: cls.student_name || '',
      group_name: cls.group_name || '',
      class_type: cls.class_type || '',
      day: DAY_NAMES[cls.day_of_week] || '',
      start_time: cls.start_time || '',
      end_time: cls.end_time || '',
      duration_hours: cls.duration_hours || 1,
      is_active: cls.is_active ? 'Yes' : 'No',
      created_at: cls.created_at || '',
    }),
  },

  Attendance: {
    sheetName: 'Attendance',
    columns: ['id', 'student_name', 'class_name', 'date', 'status', 'class_type', 'duration_hours', 'fee_charged', 'topic', 'notes', 'created_at'],
    mapRow: (r) => ({
      id: r.id,
      student_name: r.student_name || '',
      class_name: r.class_name || '',
      date: r.date || '',
      status: r.status || '',
      class_type: r.class_type || '',
      duration_hours: r.duration_hours || 0,
      fee_charged: r.fee_charged || 0,
      topic: r.topic || '',
      notes: r.notes || '',
      created_at: r.created_at || '',
    }),
  },

  Fees: {
    sheetName: 'Fees',
    columns: ['id', 'student_name', 'description', 'amount', 'fee_date', 'month', 'year', 'created_at'],
    mapRow: (f) => ({
      id: f.id,
      student_name: f.student_name || '',
      description: f.description || '',
      amount: f.amount || 0,
      fee_date: f.fee_date || '',
      month: f.month || '',
      year: f.year || '',
      created_at: f.created_at || '',
    }),
  },

  Messages: {
    sheetName: 'Messages',
    columns: ['id', 'student_name', 'parent_name', 'mobile_number', 'message_type', 'message', 'is_sent', 'created_at'],
    mapRow: (m) => ({
      id: m.id,
      student_name: m.student_name || '',
      parent_name: m.parent_name || '',
      mobile_number: m.mobile_number || '',
      message_type: m.message_type || '',
      message: (m.message || '').substring(0, 500), // Truncate long messages for sheet
      is_sent: m.is_sent ? 'Yes' : 'No',
      created_at: m.created_at || '',
    }),
  },
};

const SHEET_NAMES = Object.values(SHEET_MAPPINGS).map((m) => m.sheetName);

module.exports = { SHEET_MAPPINGS, SHEET_NAMES };
