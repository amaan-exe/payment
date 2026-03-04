import React from 'react';
import { FileText } from 'lucide-react';

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header Banner */}
            <section className="py-16 bg-gradient-to-br from-rose-600 to-red-700 text-white text-center">
                <div className="max-w-4xl mx-auto px-4">
                    <FileText className="mx-auto h-12 w-12 mb-4 opacity-80" />
                    <h1 className="text-4xl font-extrabold tracking-tight">Terms of Service</h1>
                    <p className="text-rose-100 mt-3">Last updated: February 2026</p>
                </div>
            </section>

            {/* Content */}
            <section className="py-16">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-12 space-y-8">

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Acceptance of Terms</h2>
                            <p className="text-gray-600 leading-relaxed">
                                By accessing and using the DEMO NGO website (the "Service"), you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not access the Service.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Donations</h2>
                            <p className="text-gray-600 leading-relaxed">
                                All donations made through this platform are voluntary and non-refundable unless otherwise stated. Donations are processed securely through Razorpay. By making a donation, you confirm that the payment method used is yours and that you authorize the transaction.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Tax Exemption</h2>
                            <p className="text-gray-600 leading-relaxed">
                                Donations made to DEMO NGO are eligible for tax deduction under Section 80G of the Indian Income Tax Act. Tax exemption certificates will be issued to donors upon request.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Use of Service</h2>
                            <ul className="text-gray-600 space-y-2 ml-5 list-disc">
                                <li>You agree to use the Service only for lawful purposes</li>
                                <li>You will not attempt to gain unauthorized access to any part of the Service</li>
                                <li>You will not use the Service to transmit harmful or malicious content</li>
                                <li>You will provide accurate and complete information when making donations</li>
                            </ul>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Intellectual Property</h2>
                            <p className="text-gray-600 leading-relaxed">
                                All content on this website, including text, graphics, logos, and images, is the property of DEMO NGO and is protected by applicable intellectual property laws. You may not reproduce, distribute, or create derivative works without prior written consent.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Limitation of Liability</h2>
                            <p className="text-gray-600 leading-relaxed">
                                DEMO NGO shall not be liable for any indirect, incidental, or consequential damages arising from the use of this Service. We make no warranties regarding the availability or accuracy of the Service.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Changes to Terms</h2>
                            <p className="text-gray-600 leading-relaxed">
                                We reserve the right to modify these Terms of Service at any time. Continued use of the Service after changes constitutes acceptance of the new terms.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">8. Contact</h2>
                            <p className="text-gray-600 leading-relaxed">
                                For questions regarding these Terms, please contact us at <a href="mailto:legal@demongo.org" className="text-rose-600 hover:underline">legal@demongo.org</a>.
                            </p>
                        </div>

                    </div>
                </div>
            </section>
        </div>
    );
}
