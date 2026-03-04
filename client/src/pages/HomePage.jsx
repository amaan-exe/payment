import React from 'react';
import PaymentComponent from '../PaymentComponent';
import ImpactTracker from '../components/ImpactTracker';
import { Heart, ShieldCheck, HandHeart, Award, Globe, BookOpen } from 'lucide-react';

export default function HomePage() {
    return (
        <>
            {/* Hero Section */}
            <section className="relative py-20 lg:py-32 overflow-hidden bg-gradient-to-b from-rose-50 to-white">
                {/* Decorative elements */}
                <div className="absolute top-20 left-10 w-24 h-24 bg-rose-200/30 rounded-full blur-2xl"></div>
                <div className="absolute bottom-10 right-20 w-32 h-32 bg-red-200/30 rounded-full blur-2xl"></div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 flex flex-col md:flex-row items-center gap-12">
                    <div className="flex-1 text-center md:text-left">
                        <span className="inline-block py-1.5 px-4 rounded-full bg-rose-100 text-rose-700 text-sm font-semibold mb-6 animate-fade-in">
                            ✨ Join the Mission Today
                        </span>
                        <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight mb-6 tracking-tight">
                            Feeding the hungry, <br className="hidden md:block" />
                            <span className="text-rose-600 bg-gradient-to-r from-rose-600 to-red-600 bg-clip-text text-transparent">one meal at a time.</span>
                        </h1>
                        <p className="text-lg text-gray-600 mb-8 max-w-xl mx-auto md:mx-0 leading-relaxed">
                            Thousands sleep hungry every night. Your small contribution can provide a warm, nutritious meal to someone in need. Let's make a difference together.
                        </p>
                        <div className="flex flex-wrap gap-4 justify-center md:justify-start">
                            <a href="#donate" className="bg-gradient-to-r from-rose-600 to-red-600 text-white px-8 py-3.5 rounded-full font-bold shadow-lg shadow-rose-500/30 hover:shadow-rose-500/50 hover:scale-105 transition-all duration-300 flex items-center gap-2">
                                Donate Now <Heart className="h-5 w-5 fill-current" />
                            </a>
                            <a href="/about" className="border-2 border-gray-200 text-gray-700 px-8 py-3.5 rounded-full font-bold hover:border-rose-300 hover:text-rose-600 transition-all duration-300">
                                Learn More
                            </a>
                        </div>
                    </div>

                    <div className="flex-1 items-center justify-center w-full flex" id="donate">
                        <div className="w-full max-w-md mx-auto">
                            <PaymentComponent />
                        </div>
                    </div>
                </div>
            </section>

            {/* Live Impact Tracker */}
            <ImpactTracker />

            {/* Why Donate Section */}
            <section className="py-20 bg-white">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <span className="text-rose-600 font-semibold text-sm tracking-wider uppercase">Why Choose Us</span>
                        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mt-3 mb-4">Every Rupee Makes a Difference</h2>
                        <p className="text-gray-500 max-w-2xl mx-auto">We ensure your donation reaches those who need it the most, with full accountability and love.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="group p-8 rounded-2xl bg-gradient-to-br from-rose-50 to-white border border-rose-100 hover:shadow-xl hover:shadow-rose-100/50 transition-all duration-300">
                            <div className="bg-rose-100 w-14 h-14 rounded-xl flex items-center justify-center mb-5 group-hover:bg-rose-200 transition">
                                <Award className="h-7 w-7 text-rose-600" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-3">100% Transparent</h3>
                            <p className="text-gray-500 leading-relaxed">Every donation is tracked. Annual audit reports are publicly available for complete financial transparency.</p>
                        </div>

                        <div className="group p-8 rounded-2xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 hover:shadow-xl hover:shadow-emerald-100/50 transition-all duration-300">
                            <div className="bg-emerald-100 w-14 h-14 rounded-xl flex items-center justify-center mb-5 group-hover:bg-emerald-200 transition">
                                <Globe className="h-7 w-7 text-emerald-600" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-3">Pan-India Reach</h3>
                            <p className="text-gray-500 leading-relaxed">We operate across 15+ states, reaching the most underserved communities with nutritious meals.</p>
                        </div>

                        <div className="group p-8 rounded-2xl bg-gradient-to-br from-purple-50 to-white border border-purple-100 hover:shadow-xl hover:shadow-purple-100/50 transition-all duration-300">
                            <div className="bg-purple-100 w-14 h-14 rounded-xl flex items-center justify-center mb-5 group-hover:bg-purple-200 transition">
                                <BookOpen className="h-7 w-7 text-purple-600" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-3">80G Tax Benefit</h3>
                            <p className="text-gray-500 leading-relaxed">All donations are eligible for tax deduction under Section 80G of the Income Tax Act.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Trust / Partners Section */}
            <section className="py-16 bg-gray-50 border-y border-gray-100">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <ShieldCheck className="mx-auto h-10 w-10 text-rose-600 mb-4" />
                    <p className="text-sm font-semibold text-gray-400 tracking-wider uppercase mb-8">Trusted by renowned partners</p>
                    <div className="flex flex-wrap justify-center gap-12 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-500">
                        <div className="text-2xl font-black text-gray-800 flex items-center gap-2">UN Food Fund</div>
                        <div className="text-2xl font-bold text-gray-800 italic">GlobalCare</div>
                        <div className="text-2xl font-serif text-gray-800 border-2 border-gray-800 px-3 py-1 rounded">FeedingEarth</div>
                    </div>
                </div>
            </section>
        </>
    );
}
