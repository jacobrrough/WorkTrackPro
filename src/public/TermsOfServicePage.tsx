import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Public (no-auth) Terms of Service page served at /terms.
 *
 * Stable URL to share with Plaid and other reviewers. This is customer-facing, so it
 * uses a clean LIGHT theme (not the dark admin app) and renders the full content of
 * docs/TERMS_OF_SERVICE.md faithfully as styled JSX. Keep this file free of any
 * accounting-module imports — it is core/public and must load for logged-out visitors.
 */

const EFFECTIVE_DATE = 'June 17, 2026';

const TermsOfServicePage: React.FC = () => {
  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-800">
      <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="mb-10 border-b border-slate-200 pb-8">
          <Link
            to="/"
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            &larr; Rough Cut Manufacturing
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-4 text-base leading-relaxed text-subtle">
            <span className="font-semibold text-slate-900">Rough Cut Manufacturing</span>{' '}
            ("Company," "we," "us") provides the WorkTrackPro application (the "Service"). These
            Terms of Service ("Terms") govern your access to and use of the Service.
          </p>
          <dl className="mt-6 space-y-1 text-sm text-subtle">
            <div>
              <dt className="inline font-semibold text-slate-900">Effective date: </dt>
              <dd className="inline">{EFFECTIVE_DATE}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-slate-900">Contact: </dt>
              <dd className="inline">
                Jacob Rough, CEO &mdash;{' '}
                <a
                  href="mailto:jacobrrough@gmail.com"
                  className="text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  jacobrrough@gmail.com
                </a>
              </dd>
            </div>
          </dl>
        </header>

        <article className="space-y-10 text-base leading-relaxed text-slate-700">
          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              1. Acceptance of these Terms
            </h2>
            <p>
              By accessing or using the Service, you agree to these Terms and to our Privacy Policy.
              If you do not agree, do not use the Service. If you use the Service on behalf of an
              organization, you represent that you are authorized to bind that organization.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">2. The Service</h2>
            <p>
              WorkTrackPro provides job and manufacturing management, inventory, and accounting
              features, including invoicing, estimates, and&mdash;where enabled&mdash;bank-feed and
              accounting-platform integrations. We may add, change, or remove features over time.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              3. Accounts and eligibility
            </h2>
            <p>
              You must provide accurate information, keep your credentials confidential, enable
              multi-factor authentication where required, and are responsible for activity under
              your account. You must be of legal age to form a binding contract.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">4. Acceptable use</h2>
            <p>
              You agree not to: (a) use the Service unlawfully or to violate the rights of others;
              (b) attempt to gain unauthorized access to the Service or its systems; (c) interfere
              with or disrupt the Service; (d) reverse engineer or copy the Service except as
              permitted by law; or (e) upload malicious code or content you lack the right to use.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">5. Your data and content</h2>
            <p>
              You retain ownership of the data and content you submit ("Customer Data"). You grant
              us a limited license to host and process Customer Data solely to provide and support
              the Service. You are responsible for the accuracy and lawfulness of Customer Data and
              for having the necessary rights and consents to provide it to us.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              6. Financial-account connections
            </h2>
            <p>
              If you connect a bank, credit-card, or accounting account (e.g., via Plaid or
              QuickBooks Online), you authorize us and those providers to access and use the related
              information to provide the Service, as described in our Privacy Policy. You may
              disconnect at any time.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">7. Third-party services</h2>
            <p>
              The Service integrates with third-party providers (e.g., Supabase, Netlify, Plaid,
              Intuit). Your use of those services may be subject to their terms and privacy
              policies. We are not responsible for third-party services we do not control.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">8. Intellectual property</h2>
            <p>
              The Service, including its software, design, and content (excluding Customer Data), is
              owned by the Company and its licensors and is protected by applicable law. We grant
              you a limited, non-exclusive, non-transferable right to use the Service per these
              Terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">9. Disclaimers</h2>
            <p>
              The Service is provided "as is" and "as available," without warranties of any kind,
              express or implied, including merchantability, fitness for a particular purpose, and
              non-infringement. We do not warrant that the Service will be uninterrupted,
              error-free, or that data will always be accurate. The Service does not provide legal,
              tax, or accounting advice.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              10. Limitation of liability
            </h2>
            <p>
              To the maximum extent permitted by law, the Company will not be liable for indirect,
              incidental, special, consequential, or punitive damages, or for lost profits or data.
              Our total liability for any claim relating to the Service will not exceed the amounts
              you paid us for the Service in the twelve months before the claim (or USD $100 if
              none).
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">11. Indemnification</h2>
            <p>
              You agree to indemnify and hold the Company harmless from claims arising out of your
              Customer Data, your use of the Service, or your violation of these Terms or applicable
              law.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">12. Termination</h2>
            <p>
              You may stop using the Service at any time. We may suspend or terminate access if you
              violate these Terms or to protect the Service or its users. On termination, your right
              to use the Service ends; we handle remaining data per our Data Retention &amp;
              Deletion Policy.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">13. Governing law</h2>
            <p>
              These Terms are governed by the laws of the State of California, without regard to
              conflict-of-laws rules. Disputes will be resolved in the state or federal courts
              located in California, unless applicable law requires otherwise.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              14. Changes to these Terms
            </h2>
            <p>
              We may update these Terms; we will post the updated version with a new effective date
              and, where required, provide additional notice. Continued use after changes means you
              accept the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">15. Contact</h2>
            <p>
              Rough Cut Manufacturing &mdash; Jacob Rough, CEO &mdash;{' '}
              <a
                href="mailto:jacobrrough@gmail.com"
                className="text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                jacobrrough@gmail.com
              </a>
            </p>
          </section>
        </article>

        <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-subtle">
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/" className="hover:text-slate-700 hover:underline">
              Home
            </Link>
            <Link to="/privacy" className="hover:text-slate-700 hover:underline">
              Privacy Policy
            </Link>
          </nav>
          <p className="mt-4">&copy; {new Date().getFullYear()} Rough Cut Manufacturing.</p>
        </footer>
      </main>
    </div>
  );
};

export default TermsOfServicePage;
