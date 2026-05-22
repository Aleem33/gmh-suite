import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Activity, Clock, Printer, Save, Search, UserRound } from 'lucide-react';
import { db, auth } from '../../firebase';
import { formatDate, nowISO, today } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { printVitalsOnPrescriptionPad } from '../lib/pdf';

const emptyVitals = { bp: '', temperature: '', weight: '', pulse: '', spo2: '', complaint: '', notes: '' };

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    vitals_pending: 'bg-amber-100 text-amber-700',
    vitals_done: 'bg-purple-100 text-purple-700',
    in_consultation: 'bg-indigo-100 text-indigo-700',
    completed: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {(status || 'waiting').replace(/_/g, ' ')}
    </span>
  );
}

export function VitalsQueue() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState(emptyVitals);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'appointments'), snap => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((a: any) => a.date === today() && ['vitals_pending', 'vitals_done', 'in_consultation'].includes(a.status))
        .sort((a: any, b: any) => (a.tokenNo || 9999) - (b.tokenNo || 9999));
      setAppointments(rows);
    });
    return () => unsub();
  }, []);

  const waiting = appointments.filter(a => a.status === 'vitals_pending');
  const ready = appointments.filter(a => a.status === 'vitals_done' || a.status === 'in_consultation');
  const filtered = appointments.filter(a => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return a.patientName?.toLowerCase().includes(q) || a.patientMRN?.toLowerCase().includes(q) || String(a.tokenNo || '').includes(q);
  });

  const open = (appt: any) => {
    setSelected(appt);
    setForm({
      bp: appt.vitals?.bp || '',
      temperature: appt.vitals?.temperature || '',
      weight: appt.vitals?.weight || '',
      pulse: appt.vitals?.pulse || '',
      spo2: appt.vitals?.spo2 || '',
      complaint: appt.vitals?.complaint || appt.notes || '',
      notes: appt.vitals?.notes || '',
    });
    setMessage('');
  };

  const saveVitals = async (printAfter = false) => {
    if (!selected) return;
    setSaving(true);
    setMessage('');
    try {
      const vitals = { ...form };
      await updateDoc(doc(db, 'appointments', selected.id), {
        vitals,
        status: 'vitals_done',
        vitalsSubmittedAt: nowISO(),
        vitalsSubmittedBy: auth.currentUser?.email || '',
        updatedAt: nowISO(),
      });
      await logAudit('update', 'appointment', selected.id, `Vitals submitted for ${selected.patientName}`);
      const updated = { ...selected, vitals, status: 'vitals_done' };
      setSelected(updated);
      setMessage('Vitals saved. Patient is ready for doctor.');
      if (printAfter) printVitalsOnPrescriptionPad({ ...updated, vitals, date: formatDate(updated.date) });
    } catch (e: any) {
      setMessage(e.message || 'Could not save vitals.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vitals Queue</h1>
          <p className="text-sm text-gray-500">Waiting: {waiting.length} · Ready for doctor: {ready.length}</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search token, patient or MRN..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Token', 'Patient', 'Doctor', 'Time', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400 text-sm">No patients in vitals queue</td></tr>
              ) : filtered.map(a => (
                <tr key={a.id} className={`hover:bg-gray-50/60 ${selected?.id === a.id ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-4 py-3"><div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">{a.tokenNo || '-'}</div></td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-gray-900">{a.patientName}</div>
                    <div className="text-xs text-gray-400">{a.patientMRN} · {a.patientAge || '-'}yrs · {a.patientGender || '-'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-700">{a.doctorName || '-'}</div>
                    <div className="text-xs text-gray-400">{a.department || 'General Medicine'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500"><Clock className="inline w-3.5 h-3.5 mr-1" />{a.time}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => open(a)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
                      {a.status === 'vitals_pending' ? 'Record' : 'Review'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          {!selected ? (
            <div className="h-full min-h-80 flex flex-col items-center justify-center text-center text-gray-400">
              <Activity className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-sm">Select a patient to record vitals</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 pb-3 border-b border-gray-100">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <UserRound className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-gray-900 truncate">{selected.patientName}</h2>
                  <p className="text-xs text-gray-400">Token {selected.tokenNo || '-'} · {formatDate(selected.date)} · {selected.time}</p>
                </div>
              </div>

              {message && <div className="text-xs rounded-lg bg-blue-50 text-blue-700 px-3 py-2">{message}</div>}

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['BP', 'bp', '120/80'],
                  ['Temp F', 'temperature', '98.6'],
                  ['Weight kg', 'weight', '70'],
                  ['Pulse', 'pulse', '72'],
                  ['SpO2 %', 'spo2', '99'],
                ].map(([label, key, placeholder]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input value={(form as any)[key]} onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))} placeholder={placeholder}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Complaint / Reason</label>
                <textarea value={form.complaint} onChange={e => setForm(v => ({ ...v, complaint: e.target.value }))} rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Vitals Notes</label>
                <textarea value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button onClick={() => saveVitals(false)} disabled={saving} className="flex items-center justify-center gap-2 border border-blue-200 text-blue-700 bg-blue-50 py-2 rounded-lg text-sm font-semibold hover:bg-blue-100 disabled:opacity-60">
                  <Save className="w-4 h-4" /> Save
                </button>
                <button onClick={() => saveVitals(true)} disabled={saving} className="flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">
                  <Printer className="w-4 h-4" /> Save & Print Pad
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
