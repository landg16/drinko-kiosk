import { useNavigate } from 'react-router-dom';
import {
  CreditCard,
  QrCode,
  ArrowLeft,
  Edit2,
  Trash2,
  Wifi,
  Smartphone,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { generalStore } from '@/store/general-store.ts';
import { cn } from '@/lib/utils';
import { InactivityTimer } from '@/components/shared/inactivity-timer';

export function PaymentPage() {
  const navigate = useNavigate();
  const { cart, removeFromCart, openDrinkModal } = generalStore();
  const [paymentView, setPaymentView] = useState<'summary' | 'card' | 'qr'>('summary');
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'rejected'>('pending');

  const total = cart.reduce(
    (sum, item) => sum + (item.isDouble ? item.price * 1.8 : item.price) * item.quantity,
    0,
  );

  useEffect(() => {
    let timeout: NodeJS.Timeout | undefined;

    if (paymentView !== 'summary') {
      // Reset status when entering a payment view
      setPaymentStatus('pending');

      // Simulate payment process
      // 80% chance of success, 20% chance of rejection for demo purposes
      // In real app, this would be a socket/API listener
      const isSuccess = Math.random() > 0.2;
      const delay = paymentView === 'qr' ? 8000 : 4000; // QR takes longer to scan

      timeout = setTimeout(() => {
        setPaymentStatus(isSuccess ? 'success' : 'rejected');

        if (isSuccess) {
          setTimeout(() => navigate('/pouring'), 2000);
        } else {
          // If rejected, go back to summary after a delay to try again
          setTimeout(() => {
            setPaymentView('summary');
            setPaymentStatus('pending');
          }, 3000);
        }
      }, delay);
    }

    return () => clearTimeout(timeout);
  }, [paymentView, navigate]);

  // Card Payment View
  if (paymentView === 'card') {
    return (
      <div className='h-full w-full flex flex-col bg-zinc-950 text-white p-8 relative items-center justify-center animate-in fade-in zoom-in duration-300'>
        <InactivityTimer />

        {paymentStatus === 'pending' && (
          <button
            onClick={() => setPaymentView('summary')}
            className='absolute top-8 left-8 p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white'
          >
            <ArrowLeft className='w-8 h-8' />
          </button>
        )}

        <div className='flex flex-col items-center gap-12'>
          {paymentStatus === 'pending' && (
            <>
              <div className='relative'>
                <div className='absolute inset-0 bg-purple-500/20 blur-3xl rounded-full animate-pulse' />
                <div className='w-64 h-64 bg-zinc-900 rounded-full border-4 border-purple-500 flex items-center justify-center relative overflow-hidden shadow-[0_0_50px_rgba(168,85,247,0.3)]'>
                  <div className='absolute inset-0 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-purple-500/10 to-transparent' />
                  <Wifi className='w-32 h-32 text-purple-500 rotate-90 animate-pulse' />
                </div>

                <div className='absolute -bottom-4 -right-4 animate-bounce duration-2000'>
                  <div className='bg-white text-black p-4 rounded-xl shadow-xl transform -rotate-12'>
                    <CreditCard className='w-12 h-12' />
                  </div>
                </div>

                <div className='absolute -top-4 -left-4 animate-bounce duration-2000 delay-700'>
                  <div className='bg-zinc-800 text-white p-4 rounded-xl shadow-xl transform rotate-12 border border-zinc-700'>
                    <Smartphone className='w-12 h-12' />
                  </div>
                </div>
              </div>

              <div className='text-center space-y-4'>
                <h2 className='text-4xl font-bold'>Tap to Pay</h2>
                <p className='text-2xl text-zinc-400'>Hold your card or phone near the reader</p>
                <p className='text-3xl font-mono font-bold text-purple-400 mt-4'>
                  ${total.toFixed(2)}
                </p>
              </div>
            </>
          )}

          {paymentStatus === 'success' && (
            <div className='flex flex-col items-center gap-8 animate-in zoom-in duration-300'>
              <div className='w-48 h-48 rounded-full bg-green-500/20 flex items-center justify-center border-4 border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.5)]'>
                <CheckCircle2 className='w-24 h-24 text-green-500' />
              </div>
              <h2 className='text-5xl font-bold text-green-500'>Payment Successful!</h2>
              <p className='text-2xl text-zinc-400'>Preparing your drinks...</p>
            </div>
          )}

          {paymentStatus === 'rejected' && (
            <div className='flex flex-col items-center gap-8 animate-in zoom-in duration-300'>
              <div className='w-48 h-48 rounded-full bg-red-500/20 flex items-center justify-center border-4 border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.5)]'>
                <XCircle className='w-24 h-24 text-red-500' />
              </div>
              <h2 className='text-5xl font-bold text-red-500'>Payment Rejected</h2>
              <p className='text-2xl text-zinc-400'>Please try again or use a different method</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // QR Payment View
  if (paymentView === 'qr') {
    return (
      <div className='h-full w-full flex flex-col bg-zinc-950 text-white p-8 relative items-center justify-center animate-in fade-in zoom-in duration-300'>
        <InactivityTimer />

        {paymentStatus === 'pending' && (
          <button
            onClick={() => setPaymentView('summary')}
            className='absolute top-8 left-8 p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white'
          >
            <ArrowLeft className='w-8 h-8' />
          </button>
        )}

        <div className='flex flex-col items-center gap-12'>
          {paymentStatus === 'pending' && (
            <>
              <div className='p-8 bg-white rounded-3xl shadow-[0_0_50px_rgba(34,197,94,0.2)] relative'>
                <div className='absolute -inset-1 bg-linear-to-br from-green-500 to-emerald-600 rounded-[28px] -z-10 blur-sm animate-pulse' />
                <QrCode className='w-64 h-64 text-black' />
              </div>

              <div className='text-center space-y-4'>
                <h2 className='text-4xl font-bold'>Scan to Pay</h2>
                <p className='text-2xl text-zinc-400'>Use the Keepz app to scan the QR code</p>
                <p className='text-3xl font-mono font-bold text-green-500 mt-4'>
                  ${total.toFixed(2)}
                </p>
              </div>

              <div className='flex items-center gap-3 text-zinc-500 bg-zinc-900/50 px-6 py-3 rounded-full border border-zinc-800'>
                <Loader2 className='w-5 h-5 animate-spin' />
                <span>Waiting for payment confirmation...</span>
              </div>
            </>
          )}

          {paymentStatus === 'success' && (
            <div className='flex flex-col items-center gap-8 animate-in zoom-in duration-300'>
              <div className='w-48 h-48 rounded-full bg-green-500/20 flex items-center justify-center border-4 border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.5)]'>
                <CheckCircle2 className='w-24 h-24 text-green-500' />
              </div>
              <h2 className='text-5xl font-bold text-green-500'>Payment Successful!</h2>
              <p className='text-2xl text-zinc-400'>Preparing your drinks...</p>
            </div>
          )}

          {paymentStatus === 'rejected' && (
            <div className='flex flex-col items-center gap-8 animate-in zoom-in duration-300'>
              <div className='w-48 h-48 rounded-full bg-red-500/20 flex items-center justify-center border-4 border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.5)]'>
                <XCircle className='w-24 h-24 text-red-500' />
              </div>
              <h2 className='text-5xl font-bold text-red-500'>Payment Rejected</h2>
              <p className='text-2xl text-zinc-400'>Please try again</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Summary View
  return (
    <div className='h-full w-full flex flex-col bg-zinc-950 text-white p-8 relative'>
      <InactivityTimer />

      <div className='flex items-center gap-6 mb-8 mt-8'>
        <button
          onClick={() => navigate('/menu')}
          className='p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white'
        >
          <ArrowLeft className='w-8 h-8' />
        </button>
        <h1 className='text-4xl font-bold'>CHECKOUT</h1>
      </div>

      <div className='flex-1 flex flex-col gap-8 overflow-hidden'>
        {/* Top: Order Summary */}
        <div className='flex-1 flex flex-col bg-zinc-900/50 rounded-3xl border border-zinc-800 overflow-hidden'>
          <div className='p-6 border-b border-zinc-800 bg-zinc-900'>
            <h2 className='text-2xl font-bold text-zinc-200'>Order Summary</h2>
          </div>

          <div className='flex-1 overflow-y-auto p-6 space-y-4'>
            {cart.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className='flex items-center justify-between p-4 bg-zinc-950 rounded-xl border border-zinc-800 group'
              >
                <div className='flex flex-col'>
                  <span className='font-bold text-lg'>{item.name}</span>
                  <div className='flex items-center gap-2'>
                    {item.isDouble && (
                      <span className='text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30'>
                        Double
                      </span>
                    )}
                    <span className='text-zinc-400 text-sm'>x{item.quantity}</span>
                  </div>
                </div>

                <div className='flex items-center gap-4'>
                  <span className='text-xl font-mono text-purple-400'>
                    ${((item.isDouble ? item.price * 1.8 : item.price) * item.quantity).toFixed(2)}
                  </span>

                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => openDrinkModal(item, item)}
                      className='p-3 bg-zinc-800 rounded-lg text-zinc-400 active:text-white active:bg-zinc-700'
                    >
                      <Edit2 className='w-5 h-5' />
                    </button>
                    <button
                      onClick={() => removeFromCart(index)}
                      className='p-3 bg-red-500/10 rounded-lg text-red-500 active:bg-red-500 active:text-white'
                    >
                      <Trash2 className='w-5 h-5' />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className='p-6 border-t border-zinc-800 bg-zinc-900'>
            <div className='flex justify-between items-end'>
              <span className='text-zinc-400 text-lg'>Total Amount</span>
              <span className='text-4xl font-bold text-white font-mono'>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Bottom: Payment Methods */}
        <div className='h-48 flex gap-6'>
          {/* Card Payment */}
          <button
            onClick={() => setPaymentView('card')}
            disabled={cart.length === 0}
            className={cn(
              'flex-1 bg-zinc-900 rounded-3xl border-2 p-8 flex items-center justify-center gap-8 relative overflow-hidden group transition-all active:scale-95',
              'border-zinc-800 hover:border-purple-500/50',
              cart.length === 0 ? 'opacity-50 cursor-not-allowed' : '',
            )}
          >
            <div className='absolute inset-0 bg-linear-to-r from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity' />

            <div className='w-24 h-24 rounded-full bg-zinc-950 flex items-center justify-center border-2 border-zinc-800 shadow-lg shrink-0'>
              <CreditCard className='w-10 h-10 text-purple-400' />
            </div>

            <div className='text-left'>
              <h3 className='text-2xl font-bold mb-1'>Card Payment</h3>
              <p className='text-zinc-400'>Tap to pay with contactless card</p>
            </div>
          </button>

          {/* QR Payment */}
          <button
            onClick={() => setPaymentView('qr')}
            disabled={cart.length === 0}
            className={cn(
              'flex-1 bg-zinc-900 rounded-3xl border-2 p-8 flex items-center justify-center gap-8 relative overflow-hidden group transition-all active:scale-95',
              'border-zinc-800 hover:border-green-500/50',
              cart.length === 0 ? 'opacity-50 cursor-not-allowed' : '',
            )}
          >
            <div className='absolute inset-0 bg-linear-to-r from-green-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity' />

            <div className='w-24 h-24 bg-white p-2 rounded-2xl flex items-center justify-center shrink-0'>
              <QrCode className='w-full h-full text-black' />
            </div>

            <div className='text-left'>
              <h3 className='text-2xl font-bold mb-1'>QR Payment</h3>
              <p className='text-zinc-400'>Scan with Keepz app</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
