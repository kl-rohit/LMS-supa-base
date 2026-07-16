import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Edit2,
  Trash2,
  Users,
  UsersRound,
  ChevronRight,
  UserPlus,
  UserMinus,
  X,
  RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageTitle } from '../components/ConsoleUI';
import api from '../utils/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import QuickCreateModal from '../components/QuickCreateModal';

export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, group: null });
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [quickStudentOpen, setQuickStudentOpen] = useState(false);
  // Status filter for the groups list (mirrors the Students page pattern).
  const [statusFilter, setStatusFilter] = useState('active'); // active | inactive | all

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [groupsData, studentsData] = await Promise.all([
        api.get('/groups'),
        api.get('/students'),
      ]);
      setGroups(groupsData.groups || []);
      setStudents((studentsData.students || []).filter((s) => s.status === 'active'));
    } catch (err) {
      toast.error('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupMembers = async (group) => {
    try {
      setLoadingMembers(true);
      const result = await api.get(`/groups/${group.id}/students`);
      setGroupMembers(result.students || []);
    } catch (err) {
      toast.error('Failed to load members: ' + err.message);
      setGroupMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Please give the group a name.');
      return;
    }
    try {
      setSaving(true);
      if (editingGroup) {
        await api.put(`/groups/${editingGroup.id}`, form);
        toast.success('Group updated');
      } else {
        await api.post('/groups', form);
        toast.success('Group created');
      }
      setModalOpen(false);
      setEditingGroup(null);
      setForm({ name: '', description: '' });
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (e, group) => {
    e.stopPropagation();
    setEditingGroup(group);
    setForm({ name: group.name || '', description: group.description || '' });
    setModalOpen(true);
  };

  const openAdd = () => {
    setEditingGroup(null);
    setForm({ name: '', description: '' });
    setModalOpen(true);
  };

  const handleDelete = async () => {
    const group = deleteDialog.group;
    if (!group) return;
    try {
      // Inactive groups get permanently deleted; active ones are deactivated.
      // Mirrors the Students soft/hard delete pattern.
      const url = group.status === 'inactive'
        ? `/groups/${group.id}?force=true`
        : `/groups/${group.id}`;
      await api.delete(url);
      toast.success(group.status === 'inactive' ? 'Group permanently deleted' : 'Group deactivated');
      if (selectedGroup?.id === group.id) {
        setSelectedGroup(null);
        setGroupMembers([]);
      }
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Flip an inactive group back to active.
  const handleReactivate = async (group) => {
    try {
      await api.put(`/groups/${group.id}`, { status: 'active' });
      toast.success(`${group.name} reactivated`);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleGroupClick = async (group) => {
    setSelectedGroup(group);
    await fetchGroupMembers(group);
  };

  const addMember = async (studentId) => {
    if (!selectedGroup) return;
    try {
      await api.post(`/groups/${selectedGroup.id}/students`, { student_id: studentId });
      toast.success('Member added');
      fetchGroupMembers(selectedGroup);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // A student created inline from the Add Members modal should land straight
  // into the group the admin is building, and refresh the roster so it shows.
  const handleQuickStudent = async (student) => {
    if (!student?.id) { fetchData(); return; }
    if (selectedGroup) {
      await addMember(student.id);
    } else {
      fetchData();
    }
  };

  const removeMember = async (studentId) => {
    if (!selectedGroup) return;
    try {
      await api.delete(`/groups/${selectedGroup.id}/students/${studentId}`);
      toast.success('Member removed');
      fetchGroupMembers(selectedGroup);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const nonMembers = students.filter(
    (s) => !groupMembers.some((m) => m.id === s.id || m.student_id === s.id)
  );

  const filteredNonMembers = memberSearch
    ? nonMembers.filter((s) => s.name.toLowerCase().includes(memberSearch.toLowerCase()))
    : nonMembers;

  if (loading) return <Loader text="Loading groups..." />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageTitle title="Groups" />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1">
            {[
              { key: 'active', label: 'Active' },
              { key: 'inactive', label: 'Inactive' },
              { key: 'all', label: 'All' },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setStatusFilter(opt.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === opt.key
                    ? 'bg-indigo-100 text-gray-900 dark:bg-indigo-600 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={openAdd} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> New Group
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Groups List */}
        <div className="lg:col-span-1 space-y-3">
          {(() => {
            // Apply status filter. Treat missing status as 'active' for back-compat.
            const visibleGroups = groups.filter((g) => {
              if (statusFilter === 'all') return true;
              const s = g.status || 'active';
              return s === statusFilter;
            });
            if (visibleGroups.length === 0) {
              return (
                <EmptyState
                  icon={UsersRound}
                  title={statusFilter === 'inactive' ? 'No inactive groups' : 'No groups yet'}
                  message={
                    statusFilter === 'inactive'
                      ? 'Deactivated groups will appear here.'
                      : 'Create your first group to organize students.'
                  }
                  action={
                    statusFilter !== 'inactive' && (
                      <button onClick={openAdd} className="btn-primary btn-sm">
                        <Plus className="w-4 h-4" /> New Group
                      </button>
                    )
                  }
                />
              );
            }
            return visibleGroups.map((group) => (
              <div
                key={group.id}
                onClick={() => handleGroupClick(group)}
                className={`card cursor-pointer transition-all hover:shadow-md ${
                  selectedGroup?.id === group.id
                    ? 'ring-2 ring-indigo-500 border-indigo-200'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <UsersRound className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">{group.name}</h3>
                        {(group.status || 'active') === 'inactive' && (
                          <span className="badge bg-gray-100 text-gray-500 text-[10px] font-semibold">inactive</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {group.member_count || 0} member{(group.member_count || 0) !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {(group.status || 'active') === 'inactive' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReactivate(group); }}
                        className="p-1.5 rounded-md hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                        title="Reactivate group"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => openEdit(e, group)}
                      className="p-1.5 rounded-md hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteDialog({ open: true, group });
                      }}
                      className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      title={(group.status || 'active') === 'inactive' ? 'Delete permanently' : 'Deactivate group'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-gray-300 ml-1" />
                  </div>
                </div>
                {group.description && (
                  <p className="text-xs text-gray-400 mt-2">{group.description}</p>
                )}
              </div>
            ));
          })()}
        </div>

        {/* Group Members */}
        <div className="lg:col-span-2">
          {selectedGroup ? (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{selectedGroup.name} - Members</h3>
                  <p className="text-sm text-gray-500 mt-0.5">{selectedGroup.description || 'No description'}</p>
                </div>
                <button
                  onClick={() => setMembersModalOpen(true)}
                  className="btn-primary btn-sm"
                >
                  <UserPlus className="w-4 h-4" /> Add Members
                </button>
              </div>

              {loadingMembers ? (
                <Loader text="Loading members..." />
              ) : groupMembers.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No members"
                  message="Add students to this group."
                  action={
                    <button onClick={() => setMembersModalOpen(true)} className="btn-primary btn-sm">
                      <UserPlus className="w-4 h-4" /> Add Members
                    </button>
                  }
                />
              ) : (
                <div className="space-y-2">
                  {groupMembers.map((member) => (
                    <div
                      key={member.id || member.student_id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-indigo-600">
                            {(member.name || member.student_name || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{member.name || member.student_name}</p>
                          <p className="text-xs text-gray-400">{member.mobile_number || ''}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeMember(member.id || member.student_id)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                        title="Remove from group"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card flex items-center justify-center py-16">
              <div className="text-center">
                <UsersRound className="w-12 h-12 text-gray-300 mx-auto" />
                <p className="mt-3 text-gray-500">Select a group to view its members</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Group Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditingGroup(null); setForm({ name: '', description: '' }); }}
        title={editingGroup ? 'Edit Group' : 'New Group'}
        size="sm"
        onSave={handleSubmit}
        saving={saving}
        saveLabel={editingGroup ? 'Update' : 'Create Group'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Group Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field"
              placeholder="e.g., Beginners Batch"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field"
              rows={3}
              placeholder="Optional description..."
            />
          </div>
        </form>
      </Modal>

      {/* Add Members Modal */}
      <Modal
        isOpen={membersModalOpen}
        onClose={() => { setMembersModalOpen(false); setMemberSearch(''); }}
        title="Add Members"
        size="sm"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search students..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="input-field flex-1"
            />
            <button
              type="button"
              onClick={() => setQuickStudentOpen(true)}
              className="btn-secondary btn-sm flex-shrink-0 whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" /> New
            </button>
          </div>
          {filteredNonMembers.length === 0 ? (
            students.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-gray-500 mb-3">You have not added any students yet.</p>
                <button
                  onClick={() => navigate('/students')}
                  className="btn-primary btn-sm mx-auto"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add a student
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">
                {nonMembers.length === 0 ? 'Everyone is already in this group.' : 'No matching students found.'}
              </p>
            )
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2 scrollbar-thin">
              {filteredNonMembers.map((student) => (
                <div
                  key={student.id}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50"
                >
                  <span className="text-sm text-gray-700">{student.name}</span>
                  <button
                    onClick={() => addMember(student.id)}
                    className="btn-primary btn-sm py-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Inline quick-create a student without leaving the Add Members modal */}
      <QuickCreateModal
        type="student"
        isOpen={quickStudentOpen}
        onClose={() => setQuickStudentOpen(false)}
        onCreated={handleQuickStudent}
      />

      {/* Delete / Deactivate Confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, group: null })}
        onConfirm={handleDelete}
        title={deleteDialog.group?.status === 'inactive' ? 'Permanently delete group' : 'Deactivate group'}
        message={
          deleteDialog.group?.status === 'inactive'
            ? `Permanently delete "${deleteDialog.group?.name}"? This removes the group and all its student links. Attendance history is preserved. This cannot be undone.`
            : `Deactivate "${deleteDialog.group?.name}"? Members stay linked. You can reactivate it any time from the Inactive tab.`
        }
        confirmText={deleteDialog.group?.status === 'inactive' ? 'Delete forever' : 'Deactivate'}
      />
    </div>
  );
}
