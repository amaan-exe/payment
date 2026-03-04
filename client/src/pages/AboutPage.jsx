import React from 'react';
import { Heart, Target, Users, MapPin, Calendar, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AboutPage() {
    return (
        <div className="min-h-screen">
            {/* Hero Banner */}
            <section className="relative py-20 bg-gradient-to-br from-rose-600 via-red-600 to-purple-700 text-white overflow-hidden">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIvPjwvZz48L2c+PC9zdmc+')] opacity-30"></div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
                    <span className="inline-block py-1.5 px-4 rounded-full bg-white/10 text-white/90 text-sm font-semibold mb-6 backdrop-blur-sm border border-white/20">
                        About Our Mission
                    </span>
                    <h1 className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">
                        We Believe No One Should <br className="hidden md:block" />
                        Go to Bed Hungry
                    </h1>
                    <p className="text-lg text-rose-100 max-w-2xl mx-auto leading-relaxed">
                        DEMO NGO is a registered non-profit organization dedicated to eradicating hunger and malnutrition across India through community-driven food distribution programs.
                    </p>
                </div>
            </section>

            {/* Mission & Vision */}
            <section className="py-20 bg-white">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        <div className="group p-10 rounded-2xl bg-gradient-to-br from-rose-50 to-white border border-rose-100 hover:shadow-xl transition-all duration-300">
                            <div className="bg-rose-100 w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:bg-rose-200 transition">
                                <Target className="h-7 w-7 text-rose-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Mission</h2>
                            <p className="text-gray-600 leading-relaxed">
                                To provide nutritious meals to underprivileged communities across India, ensuring that no individual — child, adult, or elderly — goes hungry. We work tirelessly with local communities, volunteers, and donors to create a sustainable food distribution network.
                            </p>
                        </div>

                        <div className="group p-10 rounded-2xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 hover:shadow-xl transition-all duration-300">
                            <div className="bg-emerald-100 w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:bg-emerald-200 transition">
                                <Heart className="h-7 w-7 text-emerald-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Vision</h2>
                            <p className="text-gray-600 leading-relaxed">
                                A hunger-free India where every person has access to at least one wholesome meal a day. We envision a society where communities come together to support their most vulnerable members with compassion and dignity.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Timeline */}
            <section className="py-20 bg-gray-50">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <span className="text-rose-600 font-semibold text-sm tracking-wider uppercase">Our Journey</span>
                        <h2 className="text-3xl font-bold text-gray-900 mt-3">From a Small Idea to a Movement</h2>
                    </div>

                    <div className="space-y-8">
                        {[
                            { year: '2018', title: 'Founded', desc: 'Started with 5 volunteers serving 50 meals daily in Mumbai.' },
                            { year: '2019', title: 'Expanded Operations', desc: 'Grew to 10 cities with 200+ active volunteers.' },
                            { year: '2020', title: 'COVID Relief', desc: 'Distributed 5 lakh+ emergency food kits during the pandemic.' },
                            { year: '2022', title: 'Pan-India Presence', desc: 'Active in 15+ states, serving 10,000+ meals daily.' },
                            { year: '2024', title: 'Tech-Driven Impact', desc: 'Launched digital platform for transparent, trackable donations.' },
                        ].map((item, i) => (
                            <div key={i} className="flex gap-6 group">
                                <div className="flex flex-col items-center">
                                    <div className="bg-rose-600 text-white text-sm font-bold px-3 py-1.5 rounded-full group-hover:bg-red-600 transition">{item.year}</div>
                                    {i < 4 && <div className="w-0.5 h-full bg-rose-200 mt-2"></div>}
                                </div>
                                <div className="pb-8">
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">{item.title}</h3>
                                    <p className="text-gray-500">{item.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Team */}
            <section className="py-20 bg-white">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <span className="text-rose-600 font-semibold text-sm tracking-wider uppercase">Our Team</span>
                        <h2 className="text-3xl font-bold text-gray-900 mt-3">The People Behind the Mission</h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                        {[
                            { name: 'Priya Sharma', role: 'Founder & CEO', emoji: '👩‍💼' },
                            { name: 'Rahul Verma', role: 'Head of Operations', emoji: '👨‍💻' },
                            { name: 'Anita Desai', role: 'Community Lead', emoji: '👩‍🏫' },
                            { name: 'Vikram Patel', role: 'Finance Director', emoji: '👨‍💼' },
                        ].map((member, i) => (
                            <div key={i} className="text-center group">
                                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-rose-100 to-red-100 flex items-center justify-center mx-auto mb-4 text-4xl group-hover:scale-110 transition-transform duration-300 shadow-lg">
                                    {member.emoji}
                                </div>
                                <h3 className="font-bold text-gray-900">{member.name}</h3>
                                <p className="text-sm text-gray-500">{member.role}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="py-16 bg-gradient-to-r from-rose-600 to-red-600 text-white text-center">
                <div className="max-w-3xl mx-auto px-4">
                    <h2 className="text-3xl font-bold mb-4">Ready to Make a Difference?</h2>
                    <p className="text-rose-100 mb-8">Every donation, no matter how small, helps us serve one more meal.</p>
                    <Link to="/" className="inline-flex items-center gap-2 bg-white text-rose-600 font-bold px-8 py-3.5 rounded-full hover:bg-rose-50 transition shadow-lg">
                        Donate Now <ArrowRight className="h-5 w-5" />
                    </Link>
                </div>
            </section>
        </div>
    );
}
