import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { HandHeart, ShieldCheck, Menu, X } from 'lucide-react';
import { useState } from 'react';

import HomePage from './pages/HomePage';
import AboutPage from './pages/AboutPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import AdminPage from './pages/AdminPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import NotFoundPage from './pages/NotFoundPage';

function App() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/about', label: 'About Us' },
    { to: '/admin', label: 'Dashboard' },
  ];

  return (
    <div className="min-h-screen font-sans bg-gray-50 selection:bg-rose-100 flex flex-col">

      {/* Navbar */}
      <nav className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <HandHeart className="h-8 w-8 text-rose-600 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xl tracking-tight text-gray-900">DEMO NGO</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${location.pathname === link.to
                  ? 'bg-rose-50 text-rose-600'
                  : 'text-gray-600 hover:text-rose-600 hover:bg-gray-50'
                  }`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/"
              className="ml-3 bg-gradient-to-r from-rose-600 to-red-600 text-white px-5 py-2 rounded-full text-sm font-semibold hover:shadow-lg hover:shadow-rose-200 transition-all"
            >
              Donate
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4 space-y-1 animate-fade-in">
            {navLinks.map(link => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition ${location.pathname === link.to
                  ? 'bg-rose-50 text-rose-600'
                  : 'text-gray-600 hover:bg-gray-50'
                  }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/payment-success" element={<PaymentSuccessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 py-12 text-gray-400 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <div className="flex justify-center items-center gap-2 mb-6">
            <HandHeart className="h-6 w-6 text-gray-500" />
            <span className="font-bold text-xl tracking-tight text-white">DEMO NGO</span>
          </div>
          <p className="mb-4 text-sm text-gray-400">Registered as a non-profit under Section 8 of the Companies Act, 2013.</p>
          <div className="inline-block bg-gray-800 text-gray-300 border border-gray-700 rounded-lg px-6 py-3 mb-8 shadow-inner shadow-black/50">
            <p className="font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-400" />
              All donations are eligible for 80G Tax Exemption.
            </p>
          </div>
          <div className="text-sm flex flex-col md:flex-row justify-center items-center gap-4 text-gray-500">
            <Link to="/privacy" className="hover:text-white transition">Privacy Policy</Link>
            <span className="hidden md:inline">•</span>
            <Link to="/terms" className="hover:text-white transition">Terms of Service</Link>
            <span className="hidden md:inline">•</span>
            <span>© 2026 DEMO NGO. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
