import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, ArrowRight, Heart, Copy, Check, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function PaymentSuccessPage() {
    const [searchParams] = useSearchParams();

    // Fallback logic for when Mobile Chrome reloads and loses location.state
    const urlPaymentId = searchParams.get('payment_id');
    const urlOrderId = searchParams.get('order_id');

    const location = useLocation();
    const data = location.state || {};

    const {
        donor_name = 'Generous Donor',
        email = 'An email receipt was sent if provided',
        amount = '—',
        paymentId = urlPaymentId || '',
        orderId = urlOrderId || '',
    } = data;

    const date = new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });

    const time = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
    });

    const [copied, setCopied] = useState(false);
    const [status, setStatus] = useState('checking');
    const [serverData, setServerData] = useState(null);
    // FIX #14: Polling timeout — stop and show support message after 5 minutes
    const [pollingTimedOut, setPollingTimedOut] = useState(false);

    // Polling Mechanism for Webhook Settlement (Enterprise Edge Case 6)
    useEffect(() => {
        // If we have full data from frontend state, we don't need to poll
        if (data.paymentId && !urlPaymentId) {
            setStatus('success');
            return;
        }

        // If we only have an order_id from redirect/URL, we MUST poll to check actual success
        if (urlOrderId) {
            setStatus('verifying');
            let isMounted = true;
            // FIX #14: Timeout after 5 minutes (300s)
            const timeoutId = setTimeout(() => {
                if (isMounted) {
                    setPollingTimedOut(true);
                    setStatus('timeout');
                }
            }, 5 * 60 * 1000);

            const checkStatus = async () => {
                try {
                    const response = await axios.get(`${API_BASE_URL}/api/order/${urlOrderId}/status`);
                    if (isMounted) {
                        if (response.data.status === 'success') {
                            setServerData(response.data);
                            setStatus('success');
                        } else if (response.data.status === 'failed') {
                            setStatus('failed');
                        }
                    }
                } catch (error) {
                    console.error('Polling error', error);
                }
            };

            // Poll every 3 seconds only if not successful or failed yet
            const interval = setInterval(() => {
                setStatus((prevStatus) => {
                    if (prevStatus === 'verifying') {
                        checkStatus();
                    } else {
                        clearInterval(interval);
                    }
                    return prevStatus;
                });
            }, 3000);

            // Initial check
            checkStatus();

            return () => {
                isMounted = false;
                clearInterval(interval);
                clearTimeout(timeoutId); // FIX #14: always clear the timeout on cleanup
            };
        } else {
            setStatus('no_data');
        }
    }, [urlOrderId, urlPaymentId]);

    const displayData = serverData || {
        donor_name,
        email,
        amount,
        paymentId,
        orderId
    };

    const copyPaymentId = () => {
        navigator.clipboard.writeText(displayData.paymentId || displayData.razorpay_payment_id || '');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // If no payment data, show fallback
    if (status === 'no_data' || (!urlOrderId && !data.paymentId)) {
        return (
            <div className="min-h-[70vh] flex items-center justify-center px-4">
                <div className="text-center">
                    <Heart className="mx-auto h-16 w-16 text-gray-300 mb-4" />
                    <h2 className="text-2xl font-bold text-gray-700 mb-2">No Payment Data</h2>
                    <p className="text-gray-400 mb-6">It looks like you arrived here directly. Please make a donation first.</p>
                    <Link to="/" className="inline-flex items-center gap-2 bg-rose-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-rose-700 transition">
                        Go to Home <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        );
    }

    // FIX #14: Show timeout message if polling exceeded 5 minutes
    if (status === 'timeout' || pollingTimedOut) {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">
                <AlertCircle className="mx-auto h-16 w-16 text-amber-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Taking Longer Than Expected</h2>
                <p className="text-gray-500 max-w-sm text-center mb-6">
                    Your payment may still be processing. If money was deducted from your account, please contact support with your Order ID.
                </p>
                <p className="text-xs text-gray-400 bg-gray-100 px-4 py-2 rounded-lg font-mono mb-6">Order ID: {urlOrderId}</p>
                <Link to="/" className="inline-flex items-center gap-2 bg-rose-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-rose-700 transition">
                    Go to Home <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        );
    }

    if (status === 'verifying') {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">
                <div className="w-16 h-16 border-4 border-rose-100 border-t-rose-600 rounded-full animate-spin mb-6"></div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Verifying Payment...</h2>
                <p className="text-gray-500 max-w-sm text-center">
                    Waiting for secure confirmation from the bank. Please do not close this window.
                </p>
                <p className="text-xs text-gray-400 mt-8">Order ID: {urlOrderId}</p>
            </div>
        );
    }

    if (status === 'failed') {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">
                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
                    <span className="text-red-500 font-bold text-4xl">!</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Payment Failed</h2>
                <p className="text-gray-500 max-w-sm text-center mb-8">
                    Your payment could not be processed completely. If any money was deducted, it will be refunded within 3-5 business days.
                </p>
                <Link to="/" className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-gray-800">
                    Try Again
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-[80vh] bg-gradient-to-b from-emerald-50 via-white to-white flex items-center justify-center px-4 py-16">
            <div className="w-full max-w-lg">

                {/* Success Animation */}
                <div className="text-center mb-8">
                    <div className="relative inline-block">
                        <div className="w-24 h-24 bg-gradient-to-br from-emerald-400 to-green-600 rounded-full flex items-center justify-center mx-auto shadow-xl shadow-emerald-200 animate-success-pop">
                            <CheckCircle className="h-12 w-12 text-white" />
                        </div>
                        {/* Decorative rings */}
                        <div className="absolute inset-0 w-24 h-24 mx-auto rounded-full border-4 border-emerald-200 animate-ping opacity-20"></div>
                    </div>
                    <h1 className="text-3xl font-extrabold text-gray-900 mt-6 mb-2">Payment Successful!</h1>
                    <p className="text-gray-500">Thank you for your generous donation, <span className="font-semibold text-gray-700">{displayData.donor_name}</span></p>
                </div>

                {/* Receipt Card */}
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                    {/* Gradient Header */}
                    <div className="bg-gradient-to-r from-emerald-500 to-green-600 px-8 py-6 text-white text-center">
                        <p className="text-emerald-100 text-sm font-medium mb-1">Amount Donated</p>
                        <p className="text-4xl font-extrabold">₹{parseFloat(displayData.amount).toLocaleString('en-IN')}</p>
                    </div>

                    {/* Details */}
                    <div className="px-8 py-6 space-y-4">
                        <div className="flex justify-between items-center py-3 border-b border-gray-50">
                            <span className="text-sm text-gray-500">Donor Name</span>
                            <span className="text-sm font-semibold text-gray-900">{displayData.donor_name}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 border-b border-gray-50">
                            <span className="text-sm text-gray-500">Email</span>
                            <span className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">{displayData.email}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 border-b border-gray-50">
                            <span className="text-sm text-gray-500">Date & Time</span>
                            <span className="text-sm font-semibold text-gray-900">{date}, {time}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 border-b border-gray-50">
                            <span className="text-sm text-gray-500">Payment ID</span>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-semibold text-gray-900">{displayData.paymentId || displayData.razorpay_payment_id}</span>
                                <button onClick={copyPaymentId} className="p-1 hover:bg-gray-100 rounded transition" title="Copy">
                                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-gray-400" />}
                                </button>
                            </div>
                        </div>
                        <div className="flex justify-between items-center py-3">
                            <span className="text-sm text-gray-500">Status</span>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                                <CheckCircle className="h-3.5 w-3.5" /> Verified
                            </span>
                        </div>
                    </div>

                    {/* Tax Info */}
                    <div className="mx-8 mb-6 bg-rose-50 border border-rose-100 rounded-xl px-5 py-3.5 text-center">
                        <p className="text-sm text-rose-700 font-medium">
                            🧾 This donation is eligible for <strong>80G Tax Exemption</strong>
                        </p>
                        <p className="text-xs text-rose-500 mt-1">A receipt has been sent to your email.</p>
                    </div>

                    {/* Actions */}
                    <div className="px-8 pb-8 flex flex-col gap-3">
                        <Link
                            to="/"
                            className="w-full bg-gradient-to-r from-rose-600 to-red-600 text-white font-semibold py-3 rounded-xl text-center hover:from-rose-700 hover:to-red-700 transition-all shadow-lg shadow-rose-200 flex items-center justify-center gap-2"
                        >
                            Make Another Donation <Heart className="h-4 w-4 fill-current" />
                        </Link>
                        <Link
                            to="/"
                            className="w-full border border-gray-200 text-gray-600 font-medium py-3 rounded-xl text-center hover:bg-gray-50 transition"
                        >
                            Back to Home
                        </Link>
                    </div>
                </div>

                {/* Footer note */}
                <p className="text-center text-xs text-gray-400 mt-6">
                    If you have any questions, contact us at <a href="mailto:support@demongo.org" className="text-rose-500 hover:underline">support@demongo.org</a>
                </p>
            </div>
        </div>
    );
}
