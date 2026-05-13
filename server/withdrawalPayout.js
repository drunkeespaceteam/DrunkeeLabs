/**
 * Employee withdrawal: KYC name check, Razorpay IMPS payout, wallet refunds on failure.
 */

/** razorpay-node rejects with `{ statusCode, error }` — surface description to clients */
function normalizeRazorpayError(err) {
  if (err instanceof Error) return err
  const desc =
    err?.error?.description ||
    err?.error?.reason ||
    err?.description ||
    (typeof err?.error === 'string' ? err.error : null)
  if (desc) return new Error(String(desc))
  try {
    return new Error(JSON.stringify(err))
  } catch {
    return new Error('Razorpay request failed')
  }
}

/** Gross amount debited from wallet for a withdrawal row */
export function withdrawalGrossAmount(row) {
  if (row == null) return 0
  const r = Number(row.requested_amount)
  if (Number.isFinite(r) && r > 0) return r
  return Number(row.amount) || 0
}

/** Net amount sent via Razorpay (after platform fee) */
export function withdrawalPayoutRupees(row) {
  if (row == null) return 0
  const f = Number(row.final_amount)
  if (Number.isFinite(f) && f > 0) return f
  const gross = withdrawalGrossAmount(row)
  const fee = Number(row.fee_amount) || 0
  return Math.max(0, gross - fee)
}

/**
 * Compare verified KYC legal name with bank account holder name.
 * Requires meaningful overlap (tokens or compact equality).
 */
export function namesMatchForBankPayout(kycFullName, accountName) {
  const tokenize = (s) =>
    String(s || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2)

  const kTokens = tokenize(kycFullName)
  const aTokens = tokenize(accountName)
  if (!kTokens.length || !aTokens.length) return false

  const kCompact = kTokens.join('')
  const aCompact = aTokens.join('')
  if (kCompact === aCompact) return true
  if (kCompact.length >= 4 && aCompact.length >= 4) {
    if (kCompact.includes(aCompact) || aCompact.includes(kCompact)) return true
  }

  for (const w of aTokens) {
    const ok = kTokens.some((kw) => kw === w || kw.includes(w) || w.includes(kw))
    if (!ok) return false
  }
  return true
}

export async function creditWalletBalance(supabase, userId, amount) {
  const gross = Number(amount)
  if (!userId || !Number.isFinite(gross) || gross <= 0) return
  const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', userId).maybeSingle()
  const next = (Number(w?.balance) || 0) + gross
  const { error } = await supabase.from('wallets').update({ balance: next }).eq('user_id', userId)
  if (error) throw error
}

/**
 * Create Razorpay fund account for this withdrawal's bank details and queue IMPS payout.
 * Updates withdrawal row to processing + razorpay_payout_id.
 */
export async function createRazorpayPayoutForWithdrawal({ supabase, razorpay, withdrawal, user }) {
  try {
  if (!razorpay?.api?.post) {
    throw new Error('Razorpay client is not initialized (missing api).')
  }

  let bd = withdrawal.bank_details
  if (bd == null) bd = {}
  if (typeof bd === 'string') {
    try {
      bd = JSON.parse(bd)
    } catch {
      bd = {}
    }
  }

  const ifsc = String(bd.ifsc || '').toUpperCase().replace(/\s/g, '')
  const acct = String(bd.accountNumber || '').replace(/\s/g, '')
  const accName = String(bd.accountName || '').trim()
  if (!ifsc || !acct || !accName) {
    throw new Error('Missing bank details on withdrawal record.')
  }

  const razorpayXAccount = process.env.RAZORPAY_ACCOUNT_NUMBER
  if (!razorpayXAccount) {
    throw new Error('RAZORPAY_ACCOUNT_NUMBER is not configured for payouts.')
  }

  // razorpay-node@2.x does not expose .contacts or .payouts — use REST via .api.post
  let contactId = user.razorpay_contact_id
  const looksLikeContact = contactId && String(contactId).startsWith('cont_')
  if (!looksLikeContact) {
    const contactPayload = {
      name: String(user.name || user.email || 'User').slice(0, 140),
      type: 'employee',
      reference_id: `u${String(user.id).replace(/-/g, '')}`.slice(0, 40)
    }
    if (user.email) contactPayload.email = user.email
    const contact = await razorpay.api.post({
      url: '/contacts',
      data: contactPayload
    })
    contactId = contact.id
    await supabase.from('users').update({ razorpay_contact_id: contactId }).eq('id', user.id)
  }

  const fundAccount = await razorpay.fundAccount.create({
    contact_id: contactId,
    account_type: 'bank_account',
    bank_account: {
      name: accName.slice(0, 140),
      ifsc,
      account_number: acct
    }
  })
  const fundAccountId = fundAccount.id

  const rupees = withdrawalPayoutRupees(withdrawal)
  const amountPaise = Math.round(rupees * 100)
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    throw new Error('Invalid payout amount after fee.')
  }

  const ref = `w${String(withdrawal.id).replace(/-/g, '')}`.slice(0, 40)

  const payout = await razorpay.api.post({
    url: '/payouts',
    data: {
      account_number: razorpayXAccount,
      fund_account_id: fundAccountId,
      amount: amountPaise,
      currency: 'INR',
      mode: 'IMPS',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: ref,
      narration: `NexusDev WD ${ref}`
    }
  })

  const { data: updated, error } = await supabase
    .from('withdrawals')
    .update({
      status: 'processing',
      razorpay_payout_id: payout.id,
      processed_at: new Date().toISOString(),
      attempt_count: (withdrawal.attempt_count || 0) + 1
    })
    .eq('id', withdrawal.id)
    .eq('status', 'pending')
    .select('id')

  if (error) throw error
  if (!updated?.length) {
    throw new Error('Withdrawal was not in pending state; payout not recorded.')
  }

  return { payoutId: payout.id, fundAccountId }
  } catch (err) {
    throw normalizeRazorpayError(err)
  }
}
