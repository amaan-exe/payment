import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Database, Filter, RefreshCcw, CheckCircle, Clock, XCircle, IndianRupee, Lock, Eye, EyeOff, LogOut } from 'lucide-react';

const STATUS_CONFIG = {
    success: { label: 'Success', color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle className="h-4 w-4" /> },
    pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700', icon: <Clock className="h-4 w-4" /> },
    failed: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: <XCircle className="h-4 w-4" /> },
};

function AdminLogin({ onLogin }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const res = await axios.post('/api/admin/login', { password });
            if (res.data.success && res.data.token) {
                // FIX #4: Store JWT token, NOT the raw password
                sessionStorage.setItem('adminToken', res.data.token);
                onLogin(res.data.token);
            }
        } catch (err) {
            setError('Invalid password. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[75vh] flex items-center justify-center px-4 bg-gradient-to-b from-gray-50 to-white">
            <div className="w-full max-w-sm">
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gray-800 to-gray-600"></div>

                    <div className="text-center mb-8">
                        <div className="bg-gray-100 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4">
                            <Lock className="h-8 w-8 text-gray-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900">Admin Access</h2>
                        <p className="text-gray-500 text-sm mt-1">Enter the admin password to continue</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition pr-11 ${error ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                                    placeholder="Enter admin password"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 transition"
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                            {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !password}
                            className="w-full bg-gray-900 text-white font-semibold py-3 rounded-xl hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    Verifying…
                                </>
                            ) : (
                                'Sign In'
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default function AdminPage() {
    // FIX #4: Read JWT token from sessionStorage instead of raw password
    const [adminToken, setAdminToken] = useState(sessionStorage.getItem('adminToken') || '');
    const [donations, setDonations] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [stats, setStats] = useState({ totalRaised: 0, totalDonations: 0, totalDonors: 0 });
    const [authError, setAuthError] = useState(false);

    const isAuthenticated = !!adminToken && !authError;

    const fetchData = async () => {
        setLoading(true);
        try {
            const queryParams = new URLSearchParams({ page: page.toString(), limit: '50' });
            if (filter !== 'all') queryParams.append('status', filter);

            const [donationsRes, statsRes] = await Promise.all([
                axios.get(`/api/donations?${queryParams.toString()}`, {
                    // FIX #4: Send JWT token as Bearer header instead of raw password
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                }),
                axios.get('/api/stats'),
            ]);
            setDonations(donationsRes.data.data);
            setPagination(donationsRes.data.pagination);
            setStats(statsRes.data);
            setAuthError(false);
        } catch (err) {
            if (err.response?.status === 401) {
                setAuthError(true);
                sessionStorage.removeItem('adminToken');
                setAdminToken('');
            }
            console.error('Failed to fetch data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) {
            fetchData();
        } else {
            setLoading(false);
        }
    }, [filter, page, isAuthenticated]);

    // Reset page when filter changes
    useEffect(() => {
        setPage(1);
    }, [filter]);

    const handleLogin = (token) => {
        setAdminToken(token);
        setAuthError(false);
    };

    const handleLogout = () => {
        sessionStorage.removeItem('adminToken');
        setAdminToken('');
        setAuthError(false);
    };

    if (!isAuthenticated) {
        return <AdminLogin onLogin={handleLogin} />;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <section className="py-12 bg-gradient-to-br from-gray-900 to-gray-800 text-white">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <Database className="h-8 w-8 text-rose-400" />
                            <h1 className="text-3xl font-extrabold tracking-tight">Admin Dashboard</h1>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-sm font-medium hover:bg-white/20 transition"
                        >
                            <LogOut className="h-4 w-4" /> Sign Out
                        </button>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5 border border-white/10">
                            <p className="text-gray-400 text-sm font-medium mb-1">Total Raised</p>
                            <p className="text-2xl font-bold flex items-center gap-1">
                                <IndianRupee className="h-5 w-5" />
                                {parseFloat(stats.totalRaised).toLocaleString('en-IN')}
                            </p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5 border border-white/10">
                            <p className="text-gray-400 text-sm font-medium mb-1">Successful Donations</p>
                            <p className="text-2xl font-bold">{stats.totalDonations}</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5 border border-white/10">
                            <p className="text-gray-400 text-sm font-medium mb-1">Unique Donors</p>
                            <p className="text-2xl font-bold">{stats.totalDonors}</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Toolbar */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-500 font-medium">Filter:</span>
                        {['all', 'success', 'pending', 'failed'].map(s => (
                            <button
                                key={s}
                                onClick={() => setFilter(s)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${filter === s
                                    ? 'bg-rose-600 text-white shadow-sm'
                                    : 'bg-white text-gray-600 border border-gray-200 hover:border-rose-300'
                                    }`}
                            >
                                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={fetchData}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:border-rose-300 hover:text-rose-600 transition"
                    >
                        <RefreshCcw className="h-4 w-4" /> Refresh
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    {loading ? (
                        <div className="p-16 text-center">
                            <div className="w-8 h-8 border-4 border-rose-200 border-t-rose-600 rounded-full animate-spin mx-auto mb-4"></div>
                            <p className="text-gray-400">Loading donations…</p>
                        </div>
                    ) : donations.length === 0 ? (
                        <div className="p-16 text-center">
                            <Database className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                            <p className="text-gray-400 font-medium">No donations found</p>
                            <p className="text-gray-300 text-sm mt-1">Donations will appear here once they are made.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-100 bg-gray-50/50">
                                        <th className="px-6 py-4 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Donor</th>
                                        <th className="px-6 py-4 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Email</th>
                                        <th className="px-6 py-4 text-right font-semibold text-gray-500 uppercase tracking-wider text-xs">Amount</th>
                                        <th className="px-6 py-4 text-center font-semibold text-gray-500 uppercase tracking-wider text-xs">Status</th>
                                        <th className="px-6 py-4 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Date</th>
                                        <th className="px-6 py-4 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Payment ID</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {donations.map(d => {
                                        const cfg = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
                                        return (
                                            <tr key={d.id} className="hover:bg-rose-50/30 transition">
                                                <td className="px-6 py-4 font-medium text-gray-900">{d.donor_name}</td>
                                                <td className="px-6 py-4 text-gray-500">{d.email}</td>
                                                <td className="px-6 py-4 text-right font-semibold text-gray-900">₹{parseFloat(d.amount).toLocaleString('en-IN')}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
                                                        {cfg.icon} {cfg.label}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-gray-500">
                                                    {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td className="px-6 py-4 text-gray-400 font-mono text-xs">
                                                    {d.razorpay_payment_id || '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Pagination Controls */}
                {!loading && donations.length > 0 && (
                    <div className="flex items-center justify-between mt-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <p className="text-sm text-gray-500 font-medium">
                            Showing <span className="font-bold text-gray-900">{donations.length}</span> of <span className="font-bold text-gray-900">{pagination.total}</span> donations
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition"
                            >
                                Previous
                            </button>
                            <span className="px-4 py-2 text-sm font-semibold text-gray-600">Page {page} of {pagination.totalPages}</span>
                            <button
                                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                                disabled={page === pagination.totalPages}
                                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
