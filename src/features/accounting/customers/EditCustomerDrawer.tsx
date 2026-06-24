import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { serializeCustomerAddress } from '@/services/api/accounting';
import { AccountingDrawer } from '../components/AccountingDrawer';
import { useUpdateCustomer } from '../hooks/useAccountingMutations';
import type { Customer } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Basic email sanity check — only enforced when an email is present. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The four editable address fields (the rest of CustomerAddress isn't surfaced in this form). */
interface AddressValue {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

function emptyAddress(addr: Customer['billingAddress']): AddressValue {
  return {
    line1: addr?.line1 ?? '',
    city: addr?.city ?? '',
    state: addr?.state ?? '',
    zip: addr?.zip ?? '',
  };
}

/** A labeled Street / City / State / ZIP group, shared by the billing + shipping sections. */
function AddressFieldset({
  legend,
  idPrefix,
  value,
  onChange,
}: {
  legend: string;
  idPrefix: string;
  value: AddressValue;
  onChange: (next: AddressValue) => void;
}) {
  const set = (patch: Partial<AddressValue>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="flex flex-col gap-3 rounded-sm border border-white/10 p-3">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">
        {legend}
      </legend>
      <FormField label="Street" htmlFor={`${idPrefix}-line1`}>
        <input
          id={`${idPrefix}-line1`}
          className={inputClass}
          value={value.line1}
          onChange={(e) => set({ line1: e.target.value })}
        />
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="City" htmlFor={`${idPrefix}-city`}>
          <input
            id={`${idPrefix}-city`}
            className={inputClass}
            value={value.city}
            onChange={(e) => set({ city: e.target.value })}
          />
        </FormField>
        <FormField label="State" htmlFor={`${idPrefix}-state`}>
          <input
            id={`${idPrefix}-state`}
            className={inputClass}
            value={value.state}
            onChange={(e) => set({ state: e.target.value })}
          />
        </FormField>
        <FormField label="ZIP" htmlFor={`${idPrefix}-zip`}>
          <input
            id={`${idPrefix}-zip`}
            className={inputClass}
            value={value.zip}
            onChange={(e) => set({ zip: e.target.value })}
          />
        </FormField>
      </div>
    </fieldset>
  );
}

/**
 * Drawer to edit a customer's core contact fields + billing/shipping addresses. Saves via
 * useUpdateCustomer; addresses are serialized from only the editable fields so blanking them
 * clears the column (no stale county/country left behind). Server rejections stay inline.
 */
export default function EditCustomerDrawer({
  customer,
  onClose,
}: {
  customer: Customer;
  onClose: () => void;
}) {
  const updateCustomer = useUpdateCustomer();
  const [displayName, setDisplayName] = useState(customer.displayName ?? '');
  const [companyName, setCompanyName] = useState(customer.companyName ?? '');
  const [contactName, setContactName] = useState(customer.contactName ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [terms, setTerms] = useState(customer.terms ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [taxExempt, setTaxExempt] = useState(customer.taxExempt);
  const [billing, setBilling] = useState<AddressValue>(emptyAddress(customer.billingAddress));
  const [shipping, setShipping] = useState<AddressValue>(emptyAddress(customer.shippingAddress));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    const res = await updateCustomer.mutateAsync({
      id: customer.id,
      input: {
        displayName: displayName.trim(),
        companyName: companyName.trim() || null,
        contactName: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        terms: terms.trim() || null,
        notes: notes.trim() || null,
        taxExempt,
        // Build only from the editable fields so blanking them actually clears the address.
        billingAddress: serializeCustomerAddress(billing),
        shippingAddress: serializeCustomerAddress(shipping),
      },
    });
    if (res.error || !res.customer) {
      setError(res.error ?? 'Could not save the customer.');
      return;
    }
    onClose();
  };

  return (
    <AccountingDrawer
      open
      onClose={onClose}
      title="Edit customer"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={updateCustomer.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={updateCustomer.isPending}>
            {updateCustomer.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Display name" htmlFor="cust-name" required>
          <input
            id="cust-name"
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormField>
        <FormField label="Company" htmlFor="cust-company">
          <input
            id="cust-company"
            className={inputClass}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </FormField>
        <FormField label="Contact" htmlFor="cust-contact">
          <input
            id="cust-contact"
            className={inputClass}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Email" htmlFor="cust-email">
            <input
              id="cust-email"
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Phone" htmlFor="cust-phone">
            <input
              id="cust-phone"
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Terms" htmlFor="cust-terms">
          <input
            id="cust-terms"
            className={inputClass}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="e.g. Net 30"
          />
        </FormField>
        <AddressFieldset
          legend="Billing address"
          idPrefix="cust-bill"
          value={billing}
          onChange={setBilling}
        />
        <AddressFieldset
          legend="Shipping address"
          idPrefix="cust-ship"
          value={shipping}
          onChange={setShipping}
        />
        <FormField label="Notes" htmlFor="cust-notes">
          <textarea
            id="cust-notes"
            className={inputClass}
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </FormField>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 rounded-sm border-white/20 bg-background-dark text-primary focus:ring-primary"
            checked={taxExempt}
            onChange={(e) => setTaxExempt(e.target.checked)}
          />
          Tax exempt
        </label>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </AccountingDrawer>
  );
}
