import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Home, ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
    return (
        <div className="min-h-[75vh] flex items-center justify-center px-4 bg-gradient-to-b from-gray-50 to-white">
            <div className="text-center max-w-md">
                {/* 404 Visual */}
                <div className="relative mb-8">
                    <span className="text-[150px] font-black text-gray-100 leading-none select-none">404</span>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-rose-100 p-5 rounded-2xl">
                            <MapPin className="h-12 w-12 text-rose-600" />
                        </div>
                    </div>
                </div>

                <h1 className="text-3xl font-extrabold text-gray-900 mb-3">Page Not Found</h1>
                <p className="text-gray-500 mb-8 leading-relaxed">
                    Oops! The page you're looking for doesn't exist or has been moved. Let's get you back on track.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        to="/"
                        className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-rose-600 to-red-600 text-white px-6 py-3 rounded-full font-semibold hover:shadow-lg hover:shadow-rose-200 transition-all"
                    >
                        <Home className="h-4 w-4" /> Go to Home
                    </Link>
                    <button
                        onClick={() => window.history.back()}
                        className="inline-flex items-center justify-center gap-2 border border-gray-200 text-gray-600 px-6 py-3 rounded-full font-medium hover:border-rose-300 hover:text-rose-600 transition"
                    >
                        <ArrowLeft className="h-4 w-4" /> Go Back
                    </button>
                </div>
            </div>
        </div>
    );
}
