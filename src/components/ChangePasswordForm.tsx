import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { Eye, EyeOff } from 'lucide-react';
import { auth } from '../firebase';

interface ChangePasswordFormProps {
  onSuccess?: () => void;
}

export function ChangePasswordForm({ onSuccess }: ChangePasswordFormProps) {
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setCurrentPass('');
    setNewPass('');
    setConfirmPass('');
    setShowCurrent(false);
    setShowNew(false);
  };

  const handleChangePassword = async () => {
    setMessage('');
    if (!currentPass || !newPass || !confirmPass) {
      setMessage('All fields are required.');
      return;
    }
    if (newPass.length < 6) {
      setMessage('New password must be at least 6 characters.');
      return;
    }
    if (newPass !== confirmPass) {
      setMessage('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('Not logged in.');
      const credential = EmailAuthProvider.credential(user.email, currentPass);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPass);
      resetForm();
      setMessage('Password changed successfully.');
      onSuccess?.();
    } catch (e: any) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setMessage('Current password is incorrect.');
      } else {
        setMessage('Error: ' + (e.message || 'Could not change password.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const isSuccess = message === 'Password changed successfully.';

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Enter your current password to set a new one. Password reset by email is not used because staff accounts use internal usernames.
      </p>

      {message && (
        <p className={`text-sm font-medium p-3 rounded-lg ${isSuccess ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 max-w-md">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Current Password</label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPass}
              onChange={e => setCurrentPass(e.target.value)}
              placeholder="Enter current password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              placeholder="Min. 6 characters"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowNew(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showNew ? 'Hide new password' : 'Show new password'}
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Confirm New Password</label>
          <input
            type="password"
            value={confirmPass}
            onChange={e => setConfirmPass(e.target.value)}
            placeholder="Repeat new password"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={handleChangePassword}
          disabled={saving}
          className="w-fit px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Updating...' : 'Update Password'}
        </button>
      </div>
    </div>
  );
}
