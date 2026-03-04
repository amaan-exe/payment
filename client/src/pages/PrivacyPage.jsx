import React from 'react';
import { Shield } from 'lucide-react';

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header Banner */}
            <section className="py-16 bg-gradient-to-br from-rose-600 to-red-700 text-white text-center">
                <div className="max-w-4xl mx-auto px-4">
                    <Shield className="mx-auto h-12 w-12 mb-4 opacity-80" />
                    <h1 className="text-4xl font-extrabold tracking-tight">Privacy Policy</h1>
                    <p className="text-rose-100 mt-3">Last updated: February 2026</p>
                </div>
            </section>

            {/* Content */}
            <section className="py-16">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-12 space-y-8">

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Information We Collect</h2>
                            <p className="text-gray-600 leading-relaxed">
                                When you make a donation through our platform, we collect your name, email address, and payment information. We may also collect technical data such as your IP address, browser type, and device information for analytics and security purposes.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">2. How We Use Your Information</h2>
                            <ul className="text-gray-600 space-y-2 ml-5 list-disc">
                                <li>Process your donations securely via Razorpay</li>
                                <li>Send donation receipts and tax exemption certificates</li>
                                <li>Communicate updates about our programs and impact</li>
                                <li>Improve our website and services</li>
                                <li>Comply with legal obligations</li>
                            </ul>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Payment Security</h2>
                            <p className="text-gray-600 leading-relaxed">
                                All payment transactions are processed through Razorpay, a PCI-DSS compliant payment gateway. We do not store your credit/debit card details on our servers. Razorpay's security practices can be reviewed at their website.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Data Sharing</h2>
                            <p className="text-gray-600 leading-relaxed">
                                We do not sell, trade, or rent your personal information to third parties. We may share data with trusted service providers (e.g., Razorpay for payments, email services for receipts) who assist us in operating our website and conducting our mission.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Data Retention</h2>
                            <p className="text-gray-600 leading-relaxed">
                                We retain your personal data for as long as necessary to fulfill the purposes described in this policy, including for legal, accounting, and reporting requirements.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Your Rights</h2>
                            <p className="text-gray-600 leading-relaxed">
                                You have the right to access, correct, or delete your personal data. To exercise these rights, please contact us at <a href="mailto:privacy@demongo.org" className="text-rose-600 hover:underline">privacy@demongo.org</a>.
                            </p>
                        </div>

                        <div>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Contact Us</h2>
                            <p className="text-gray-600 leading-relaxed">
                                If you have questions about this Privacy Policy, please contact us at <a href="mailto:privacy@demongo.org" className="text-rose-600 hover:underline">privacy@demongo.org</a>.
                            </p>
                        </div>

                    </div>
                </div>
            </section>
        </div>
    );
}
