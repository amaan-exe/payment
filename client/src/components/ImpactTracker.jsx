import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { Utensils, Users, Heart } from 'lucide-react';

// Animated count-up hook
function useCountUp(target, duration = 2000) {
    const [count, setCount] = useState(0);
    const prevTarget = useRef(0);

    useEffect(() => {
        if (target === 0 && prevTarget.current === 0) return;
        prevTarget.current = target;

        let start = 0;
        const startTime = performance.now();

        function step(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out curve
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                setCount(target);
            }
        }

        requestAnimationFrame(step);
    }, [target, duration]);

    return count;
}

function formatCurrency(num) {
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(1)}Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`;
    if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`;
    return `₹${num}`;
}

export default function ImpactTracker() {
    const [stats, setStats] = useState({
        totalRaised: 0,
        totalDonations: 0,
        totalDonors: 0,
    });
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        axios.get('/api/stats')
            .then(res => {
                setStats(res.data);
                setLoaded(true);
            })
            .catch(() => {
                // Fallback to zero — will display fine
                setLoaded(true);
            });
    }, []);

    const animatedRaised = useCountUp(stats.totalRaised, 2500);
    const animatedDonations = useCountUp(stats.totalDonations, 2000);
    const animatedDonors = useCountUp(stats.totalDonors, 2000);

    return (
        <section className="py-16 bg-rose-600 text-white relative overflow-hidden">
            {/* Decorative background blobs */}
            <div className="absolute top-0 left-0 w-72 h-72 bg-rose-500/30 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-red-500/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="text-center mb-12">
                    <h2 className="text-3xl font-bold mb-4">Our Live Impact</h2>
                    <p className="text-rose-100 max-w-2xl mx-auto">
                        See the real-time difference we are making in the community together.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white/10 backdrop-blur-sm p-8 rounded-2xl text-center border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-300 cursor-default group">
                        <div className="bg-white/10 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:bg-white/20 transition">
                            <Utensils className="h-8 w-8 text-rose-200" />
                        </div>
                        <h3 className="text-4xl font-extrabold mb-2">
                            {loaded ? formatCurrency(animatedRaised) : '—'}
                        </h3>
                        <p className="text-rose-200 font-medium">Total Funds Raised</p>
                    </div>

                    <div className="bg-white/10 backdrop-blur-sm p-8 rounded-2xl text-center border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-300 cursor-default group">
                        <div className="bg-white/10 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:bg-white/20 transition">
                            <Heart className="h-8 w-8 text-rose-200" />
                        </div>
                        <h3 className="text-4xl font-extrabold mb-2">
                            {loaded ? animatedDonations.toLocaleString() : '—'}
                        </h3>
                        <p className="text-rose-200 font-medium">Successful Donations</p>
                    </div>

                    <div className="bg-white/10 backdrop-blur-sm p-8 rounded-2xl text-center border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-300 cursor-default group">
                        <div className="bg-white/10 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:bg-white/20 transition">
                            <Users className="h-8 w-8 text-rose-200" />
                        </div>
                        <h3 className="text-4xl font-extrabold mb-2">
                            {loaded ? animatedDonors.toLocaleString() : '—'}
                        </h3>
                        <p className="text-rose-200 font-medium">Unique Donors</p>
                    </div>
                </div>
            </div>
        </section>
    );
}
