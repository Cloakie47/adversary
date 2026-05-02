import React, { useState, useEffect } from 'react';
import { useAccount, useConnect, useConnectors } from 'wagmi';
import { payAndVerify, getPaymentInfo } from '../lib/paymentFlow.js';

/**
 * Payment modal — shown before a paid action (debate or translation).
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   onPaid: ({ paymentToken, txHash, explorerUrl }) => void
 *   amountUsd: number  (e.g. 1.0 or 0.10)
 *   action: 'debate' | 'translation'
 *   resourceId: string | null  (attack_id for translations)
 *   actionLabel: string  (e.g. "Run Debate" or "Translate to Spanish")
 */
export default function PaymentModal({
  open,
  onClose,
  onPaid,
  amountUsd,
  action,
  resourceId = null,
  actionLabel,
}) {
  const { address, isConnected } = useAccount();
  const connect = useConnect();
  const connectors = useConnectors();
  const tempoConnector = connectors.find((c) => c.id === 'xyz.tempo') || connectors[0];

  const [status, setStatus] = useState('idle'); // idle | sending | waiting | verifying | done | error
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [result, setResult] = useState(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStatus('idle');
      setError(null);
      setResult(null);
      getPaymentInfo().then(setInfo).catch((e) => setError(e.message));
    }
  }, [open]);

  // No auto-fire — user explicitly clicks "Continue" once payment succeeds.
  // (Closing via the X without continuing means abandoning the paid token.)

  if (!open) return null;

  const handleConnect = () => {
    connect.connect({ connector: tempoConnector });
  };

  const handlePay = async () => {
    setError(null);
    try {
      const res = await payAndVerify({
        amountUsd,
        action,
        resourceId,
        onStatus: setStatus,
      });
      setResult(res);
    } catch (e) {
      setStatus('error');
      // Pretty-print common rejection cases
      const msg = e?.shortMessage || e?.message || 'Payment failed';
      if (/user rejected|user denied|cancell?ed/i.test(msg)) {
        setError('Payment cancelled.');
      } else {
        setError(msg);
      }
    }
  };

  const truncate = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';

  return (
    <div className="modal-backdrop" onClick={status === 'idle' || status === 'error' ? onClose : undefined}>
      <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
        <div className="payment-modal-header">
          <span className="payment-modal-eyebrow">Payment required</span>
          <button
            className="payment-modal-close"
            onClick={onClose}
            disabled={status !== 'idle' && status !== 'error' && status !== 'done'}
            aria-label="Close"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="payment-modal-amount">
          <span className="payment-modal-currency">$</span>
          <span className="payment-modal-amount-value">{amountUsd.toFixed(2)}</span>
          <span className="payment-modal-currency-suffix">pathUSD</span>
        </div>

        <div className="payment-modal-action">
          To {actionLabel.toLowerCase()}
        </div>

        <div className="payment-modal-rows">
          <div className="payment-modal-row">
            <span className="payment-modal-label">Network</span>
            <span className="payment-modal-value">Tempo Moderato (testnet)</span>
          </div>
          <div className="payment-modal-row">
            <span className="payment-modal-label">From</span>
            <span className="payment-modal-value">
              {isConnected ? truncate(address) : <span className="payment-modal-warn">Not connected</span>}
            </span>
          </div>
          <div className="payment-modal-row">
            <span className="payment-modal-label">To</span>
            <span className="payment-modal-value">{info ? truncate(info.treasury_address) : '…'}</span>
          </div>
        </div>

        {status === 'idle' && !isConnected && (
          <button className="btn btn-primary payment-modal-cta" onClick={handleConnect} type="button">
            Connect wallet to continue
          </button>
        )}

        {status === 'idle' && isConnected && (
          <button className="btn btn-primary payment-modal-cta" onClick={handlePay} type="button">
            Pay ${amountUsd.toFixed(2)} & continue →
          </button>
        )}

        {status === 'sending' && (
          <div className="payment-modal-status">
            <span className="status-dot pulsing" />
            Awaiting wallet signature…
            <div className="payment-modal-substatus">Approve in the Tempo Wallet popup</div>
          </div>
        )}

        {status === 'waiting' && (
          <div className="payment-modal-status">
            <span className="status-dot pulsing" />
            Confirming on Tempo…
            <div className="payment-modal-substatus">Settling on-chain (≈1 second)</div>
          </div>
        )}

        {status === 'verifying' && (
          <div className="payment-modal-status">
            <span className="status-dot pulsing" />
            Verifying payment…
            <div className="payment-modal-substatus">Backend confirms the transaction</div>
          </div>
        )}

        {status === 'done' && result && (
          <>
            <div className="payment-modal-status payment-modal-status-success">
              <span className="status-dot dot-live" />
              Payment confirmed
              <a
                href={result.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="payment-modal-tx-link"
              >
                View transaction ↗
              </a>
            </div>
            <button
              className="btn btn-primary payment-modal-cta"
              onClick={() => onPaid(result)}
              type="button"
            >
              Continue →
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="payment-modal-error">{error}</div>
            <button className="btn btn-primary payment-modal-cta" onClick={handlePay} type="button">
              Try again
            </button>
          </>
        )}

        <div className="payment-modal-foot">
          Tempo Machine Payments Protocol · pathUSD on Moderato testnet
        </div>
      </div>
    </div>
  );
}
