import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Public (no-auth) Privacy Policy page served at /privacy.
 *
 * Stable URL to share with Plaid and other reviewers. This is customer-facing, so it
 * uses a clean LIGHT theme (not the dark admin app) and renders the full content of
 * docs/PRIVACY_POLICY.md faithfully as styled JSX. Keep this file free of any
 * accounting-module imports — it is core/public and must load for logged-out visitors.
 */

const EFFECTIVE_DATE = 'June 17, 2026';

const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-50 text-slate-800">
      <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="mb-10 border-b border-slate-200 pb-8">
          <Link
            to="/"
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            &larr; Rough Cut Manufacturing
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-base leading-relaxed text-subtle">
            <span className="font-semibold text-slate-900">Rough Cut Manufacturing</span> ("we,"
            "us," "our") operates the WorkTrackPro application (the "Service"). This Privacy Policy
            explains what information we collect, how we use and protect it, and the choices you
            have.
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
            <h2 className="mb-3 text-xl font-semibold text-slate-900">1. Who this applies to</h2>
            <p>
              This policy applies to users of the Service (our staff and authorized users) and to
              individuals whose information we process in the course of operating our business,
              including our customers and the financial accounts we connect for bookkeeping.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">2. Information we collect</h2>
            <ul className="space-y-3 pl-1">
              <li className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <span>
                  <span className="font-semibold text-slate-900">Account information:</span> name,
                  email address, and role, used to create and secure user accounts.
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <span>
                  <span className="font-semibold text-slate-900">Business and job data:</span>{' '}
                  information you enter to run the business (jobs, parts, inventory, estimates,
                  invoices, customer and vendor records, and related documents).
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <span>
                  <span className="font-semibold text-slate-900">
                    Financial-account data (via Plaid):
                  </span>{' '}
                  when an authorized administrator connects a bank or credit-card account, we
                  receive account and transaction information (such as account name and mask,
                  balances, and transaction date, amount, and description) to power bookkeeping and
                  bank reconciliation. See &sect;5.
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <span>
                  <span className="font-semibold text-slate-900">
                    Accounting-platform data (via QuickBooks Online):
                  </span>{' '}
                  where connected, accounting records synced to or from QuickBooks.
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <span>
                  <span className="font-semibold text-slate-900">Usage and security data:</span>{' '}
                  limited technical data needed to operate and secure the Service, such as
                  authentication events and basic logs. We use Cloudflare Turnstile on public forms
                  to prevent abuse.
                </span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">3. How we use information</h2>
            <p>
              We use information to: provide and operate the Service (job tracking, accounting,
              invoicing, bank reconciliation); authenticate users and secure accounts; communicate
              with customers; meet legal, tax, and accounting obligations; and detect, prevent, and
              respond to fraud or security issues. We do <span className="font-semibold">not</span>{' '}
              sell personal information.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              4. How we share information
            </h2>
            <p className="mb-3">We share information only as needed to operate the Service:</p>
            <ul className="space-y-3 pl-1">
              <li className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <span>
                  <span className="font-semibold text-slate-900">
                    Service providers / subprocessors:
                  </span>{' '}
                  Supabase (database, authentication, storage hosting), Netlify (application
                  hosting), Plaid (financial-account connectivity), and Intuit/QuickBooks
                  (accounting), which process data on our behalf under their own security and
                  privacy commitments.
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <span>
                  <span className="font-semibold text-slate-900">Legal and protection:</span> when
                  required by law, or to protect the rights, property, or safety of Rough Cut
                  Manufacturing, our users, or others.
                </span>
              </li>
            </ul>
            <p className="mt-3">We do not sell or rent personal information to third parties.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              5. Financial account connections (Plaid)
            </h2>
            <p>
              We use <span className="font-semibold text-slate-900">Plaid Inc. ("Plaid")</span> to
              connect bank and credit-card accounts. By connecting an account, you authorize us and
              Plaid to access and use the account information described above to provide the
              Service. Plaid's handling of your information is governed by{' '}
              <span className="font-semibold text-slate-900">Plaid's End User Privacy Policy</span>,
              available at{' '}
              <a
                href="https://plaid.com/legal/#end-user-privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="break-words text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                https://plaid.com/legal/#end-user-privacy-policy
              </a>
              . You may <span className="font-semibold">revoke access at any time</span> by
              disconnecting the account within the Service or by contacting us; disconnecting
              removes the stored access credentials and stops further syncing. We use financial data
              solely for bookkeeping and accounting purposes and protect it as described in &sect;7.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">6. Data retention</h2>
            <p>
              We retain personal and financial information only as long as necessary to provide the
              Service and to meet our legal, tax, and accounting obligations, after which it is
              deleted or anonymized. Details are in our Data Retention &amp; Deletion Policy.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              7. How we protect information
            </h2>
            <p>
              We apply administrative, technical, and physical safeguards described in our
              Information Security Policy, including encryption in transit (TLS 1.2+), encryption at
              rest, encrypted storage of third-party access tokens, role-based access controls with
              multi-factor authentication on administrative systems, and least-privilege access. No
              method of transmission or storage is 100% secure, but we work to protect your
              information and review our controls regularly.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              8. Your rights and choices
            </h2>
            <p>
              Depending on your location, you may have the right to access, correct, or delete
              personal information we hold about you, to obtain a copy of it, and to object to or
              restrict certain processing.{' '}
              <span className="font-semibold text-slate-900">California residents</span> have rights
              under the CCPA/CPRA, including the right to know, delete, and correct personal
              information and to not be discriminated against for exercising those rights. To make a
              request, contact{' '}
              <a
                href="mailto:jacobrrough@gmail.com"
                className="text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                jacobrrough@gmail.com
              </a>
              ; we will verify and respond as required by applicable law. You can disconnect a
              linked financial account at any time (see &sect;5).
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">9. Children's privacy</h2>
            <p>
              The Service is intended for business use and is not directed to children under 13 (or
              the minimum age in your jurisdiction), and we do not knowingly collect their personal
              information.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">10. International users</h2>
            <p>
              The Service is operated in the United States; if you access it from elsewhere, your
              information will be processed in the United States.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">
              11. Changes to this policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will post the updated version
              with a new effective date and, where required, provide additional notice.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">12. Contact us</h2>
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
            <Link to="/terms" className="hover:text-slate-700 hover:underline">
              Terms of Service
            </Link>
          </nav>
          <p className="mt-4">&copy; {new Date().getFullYear()} Rough Cut Manufacturing.</p>
        </footer>
      </main>
    </div>
  );
};

export default PrivacyPolicyPage;
