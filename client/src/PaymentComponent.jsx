import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Heart, AlertCircle, ShieldCheck, Mail, User, IndianRupee } from 'lucide-react';
import { useToast } from './components/Toast';

const PRESET_AMOUNTS = [
    { value: 500, label: 'Feed a family' },
    { value: 1000, label: 'Feed 50 children' },
    { value: 2000, label: 'Weekly ration' },
    { value: 5000, label: 'Monthly ration' }
];

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PaymentComponent = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        donor_name: '',
        email: '',
        amount: ''
    });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});
    const isSubmitting = useRef(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        // Clear error on change
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const selectPreset = (amount) => {
        setFormData(prev => ({ ...prev, amount: String(amount) }));
        if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
    };

    const validate = () => {
        const newErrors = {};
        if (!formData.donor_name.trim()) newErrors.donor_name = 'Name is required';
        if (!formData.email.trim()) newErrors.email = 'Email is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Invalid email address';
        if (!formData.amount || Number(formData.amount) < 1) newErrors.amount = 'Minimum ₹1 required';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handlePayment = async (e) => {
        e.preventDefault();
        if (isSubmitting.current) return;
        if (!validate()) return;

        isSubmitting.current = true;
        setLoading(true);

        try {
            if (!window.Razorpay) {
                toast.error('Payment gateway could not load. Please check your internet connection or disable ad-blockers.');
                isSubmitting.current = false;
                setLoading(false);
                return;
            }

            const { data: orderDetails } = await axios.post('/api/create-order', {
                ...formData,
                amount: Number(formData.amount)
            });

            const options = {
                key: import.meta.env.VITE_RAZORPAY_KEY_ID,
                amount: orderDetails.amount,
                currency: orderDetails.currency,
                name: 'DEMO NGO',
                description: 'Donation for Food Distribution',
                order_id: orderDetails.orderId,
                handler: async function (response) {
                    try {
                        const verifyResult = await axios.post('/api/verify-payment', {
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        });
                        if (verifyResult.data.success) {
                            navigate('/payment-success', {
                                state: {
                                    donor_name: formData.donor_name,
                                    email: formData.email,
                                    amount: formData.amount,
                                    paymentId: response.razorpay_payment_id,
                                    orderId: response.razorpay_order_id,
                                }
                            });
                        }
                    } catch (err) {
                        console.error(err);
                        toast.error('Payment verification failed. Please contact support.');
                    }
                },
                prefill: {
                    name: formData.donor_name,
                    email: formData.email,
                },
                theme: {
                    color: '#e11d48'
                },
                callback_url: `${API_BASE_URL}/api/verify-payment-redirect`,
                redirect: true,
                modal: {
                    ondismiss: async function () {
                        try {
                            await axios.post(`${API_BASE_URL}/api/cancel-payment`, {
                                razorpay_order_id: orderDetails.orderId
                            });
                        } catch (err) {
                            console.error('Failed to notify cancellation', err);
                        }
                        toast.info('Payment process was cancelled.');
                        isSubmitting.current = false;
                        setLoading(false);
                    }
                }
            };

            const rzp1 = new window.Razorpay(options);
            rzp1.on('payment.failed', function (response) {
                console.error('Razorpay Error:', response.error);
                const errReason = response.error.reason ? `(${response.error.reason.replace(/_/g, ' ')})` : '';
                const errDesc = response.error.description || 'Payment failed. Please try again.';
                toast.error(`Payment Failed ${errReason}: ${errDesc}`);
                isSubmitting.current = false;
                setLoading(false);
            });
            rzp1.open();
        } catch (err) {
            console.error('Order Creation Error:', err);
            const errorMessage = err.response?.data?.error || 'Could not connect to the server. Please check your network and try again.';
            toast.error(errorMessage);
            isSubmitting.current = false;
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-3xl sm:rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.08)] max-w-[420px] w-full mx-auto border border-gray-100 p-6 sm:p-8 relative overflow-visible transition-all">
            {/* Top decorative floating badge */}
            <div className="absolute -top-5 sm:-top-6 left-1/2 -translate-x-1/2 bg-white px-4 sm:px-6 py-1.5 sm:py-2 rounded-full shadow-sm border border-emerald-100 flex items-center gap-2 w-max">
                <span className="relative flex h-2.5 w-2.5 sm:h-3 sm:w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-3 sm:w-3 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-700 font-semibold text-xs sm:text-sm tracking-tight whitespace-nowrap">Tax Exempt under 80G</span>
            </div>

            <div className="text-center mb-6 sm:mb-8 mt-3 sm:mt-4">
                <h2 className="text-2xl sm:text-[28px] font-extrabold text-gray-900 tracking-tight leading-tight mb-2">
                    Send your love.
                </h2>
                <p className="text-gray-500 text-xs sm:text-sm max-w-[280px] mx-auto leading-relaxed px-2">
                    100% of your donation directly buys hot, nutritious meals for those in need.
                </p>
            </div>

            <form onSubmit={handlePayment} className="space-y-5" noValidate>
                {/* Custom Styled Inputs */}
                <div className="space-y-4">
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <User className={`h-5 w-5 transition-colors ${errors.donor_name ? 'text-red-400' : 'text-gray-400 group-focus-within:text-rose-500'}`} />
                        </div>
                        <input
                            type="text"
                            name="donor_name"
                            value={formData.donor_name}
                            onChange={handleChange}
                            className={`w-full pl-11 pr-4 py-3.5 bg-gray-50/50 border rounded-2xl focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500 outline-none transition-all placeholder:text-gray-400 text-gray-800 font-medium ${errors.donor_name ? 'border-red-300 bg-red-50/50' : 'border-gray-200 hover:border-gray-300'}`}
                            placeholder="What's your full name?"
                        />
                        {errors.donor_name && (
                            <p className="absolute -bottom-5 left-2 text-red-500 text-[11px] font-medium flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" /> {errors.donor_name}
                            </p>
                        )}
                    </div>

                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Mail className={`h-5 w-5 transition-colors ${errors.email ? 'text-red-400' : 'text-gray-400 group-focus-within:text-rose-500'}`} />
                        </div>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            className={`w-full pl-11 pr-4 py-3.5 bg-gray-50/50 border rounded-2xl focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500 outline-none transition-all placeholder:text-gray-400 text-gray-800 font-medium ${errors.email ? 'border-red-300 bg-red-50/50' : 'border-gray-200 hover:border-gray-300'}`}
                            placeholder="Where should we send the receipt?"
                        />
                        {errors.email && (
                            <p className="absolute -bottom-5 left-2 text-red-500 text-[11px] font-medium flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" /> {errors.email}
                            </p>
                        )}
                    </div>
                </div>

                {/* Amount Selector - Redesigned */}
                <div className="pt-2">
                    <p className="text-gray-600 font-medium tracking-tight mb-3 ml-1 text-sm">Choose your impact today</p>
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        {PRESET_AMOUNTS.map(preset => (
                            <button
                                key={preset.value}
                                type="button"
                                onClick={() => selectPreset(preset.value)}
                                className={`relative flex flex-col items-start p-2.5 sm:p-3 rounded-2xl border transition-all duration-300 overflow-hidden ${String(preset.value) === formData.amount
                                    ? 'border-rose-500 bg-rose-50/50 ring-1 ring-rose-500'
                                    : 'border-gray-200 bg-white hover:border-rose-300 hover:bg-gray-50'
                                    }`}
                            >
                                <span className={`text-base sm:text-lg font-bold tracking-tight ${String(preset.value) === formData.amount ? 'text-rose-700' : 'text-gray-800'}`}>
                                    ₹{preset.value.toLocaleString()}
                                </span>
                                <span className={`text-[10px] sm:text-[11px] font-medium mt-0.5 ${String(preset.value) === formData.amount ? 'text-rose-600' : 'text-gray-500'}`}>
                                    {preset.label}
                                </span>
                                {String(preset.value) === formData.amount && (
                                    <div className="absolute top-0 right-0 p-1.5 bg-rose-500 rounded-bl-xl">
                                        <Heart className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-white fill-current" />
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Custom Amount Entry */}
                <div className="relative group pt-1">
                    <div className="absolute inset-y-0 left-0 pl-4 sm:pl-5 flex items-center pointer-events-none pb-0.5">
                        <IndianRupee className={`h-4 w-4 sm:h-[18px] sm:w-[18px] transition-colors ${errors.amount ? 'text-red-400' : 'text-gray-400 group-focus-within:text-rose-500'}`} />
                    </div>
                    <input
                        type="number"
                        name="amount"
                        min="1"
                        value={formData.amount}
                        onChange={handleChange}
                        className={`w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-4 bg-gray-50/50 border rounded-2xl focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500 outline-none transition-all placeholder:text-gray-400 text-gray-900 font-bold text-base sm:text-lg tracking-tight ${errors.amount ? 'border-red-300 bg-red-50/50' : 'border-gray-200 hover:border-gray-300'}`}
                        placeholder="Other amount"
                    />
                    {errors.amount && (
                        <p className="absolute -bottom-5 left-2 text-red-500 text-[11px] font-medium flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> {errors.amount}
                        </p>
                    )}
                </div>

                {/* Giant Friendly Submit Button */}
                <div className="pt-2 sm:pt-4">
                    <button
                        type="submit"
                        disabled={loading}
                        className="group relative w-full flex justify-center py-3.5 sm:py-4 px-4 border border-transparent text-base sm:text-lg font-bold rounded-2xl text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-4 focus:ring-gray-900/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden shadow-xl shadow-gray-900/10"
                    >
                        <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-rose-600 to-red-600 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-out"></div>
                        <span className="relative flex items-center gap-2">
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    Securely Processing...
                                </>
                            ) : (
                                <>
                                    Contribute {formData.amount ? `₹${Number(formData.amount).toLocaleString()}` : 'Now'}
                                    <Heart className="h-5 w-5 fill-white text-white group-hover:animate-pulse" />
                                </>
                            )}
                        </span>
                    </button>

                    {/* Trust indicators underneath */}
                    <div className="mt-5 flex items-center justify-center gap-4 text-gray-400">
                        <div className="flex items-center gap-1.5">
                            <ShieldCheck className="h-4 w-4" />
                            <span className="text-[11px] font-medium">Bank-grade Secure</span>
                        </div>
                        <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                        <div className="flex items-center gap-1.5 focus:outline-none">
                            <svg className="h-3 opacity-70" viewBox="0 0 100 20" fill="currentColor"><path d="M12.5 0v20H0V0h12.5zm19.9 0l-3.2 13.5L25.9 0H15.1l7.3 20h11.9L42.2 0H32.4zM55.8 0H43.9v20h11.9c6.9 0 12-4.5 12-10S62.7 0 55.8 0zm-1.8 15.6h-6.2v-11h6.2c3.7 0 6.5 2 6.5 5.5s-2.8 5.5-6.5 5.5zm31.7-15.6H74.3v20h9.3c5.3 0 9.1-3 9.1-7.7 0-3.3-1.8-5.5-3.8-6.2 1.3-.7 3.2-2.3 3.2-5.1 0-4.6-3.8-7.7-9.5-7.7h-31.7v0zm-1.7 8.2h-5.2v-4.9h5.2c1.9 0 3.3.9 3.3 2.5s-1.4 2.4-3.3 2.4zm1 8H80v-5h4.1c2.1 0 3.7.9 3.7 2.5 0 1.6-1.6 2.5-3.7 2.5h1.1z" /></svg>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default PaymentComponent;
