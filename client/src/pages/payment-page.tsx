import { useNavigate } from 'react-router-dom';
import { CreditCard, QrCode, ArrowLeft, X, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { generalStore } from '@/store/general-store.ts';
import { cn } from '@/lib/utils';

export function PaymentPage() {
  const navigate = useNavigate();
  const clearCart = generalStore((state) => state.clearCart);
  const [timeLeft, setTimeLeft] = useState(60); // 60 seconds timeout
  const [processingMethod, setProcessingMethod] = useState<'card' | 'qr' | null>(null);

  // Inactivity Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          clearCart();
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Reset timer on user interaction
    const resetTimer = () => setTimeLeft(60);
    window.addEventListener('click', resetTimer);
    window.addEventListener('touchstart', resetTimer);

    return () => {
      clearInterval(timer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
    };
  }, [navigate, clearCart]);

  const handlePayment = (method: 'card' | 'qr') => {
    if (processingMethod) return; // Prevent double clicks
    
    setProcessingMethod(method);
    
    // Simulate processing delay
    setTimeout(() => {
      navigate('/pouring');
    }, 3000);
  };

  const handleCancelOrder = () => {
    clearCart();
    navigate('/');
  };

  return (
    <div className='h-full w-full flex flex-col bg-zinc-950 text-white p-8 relative'>
      {/* Top Bar with Timer and Cancel */}
      <div className='absolute top-0 right-0 p-6 z-30 flex items-center gap-4'>
        <div className='bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-full px-4 py-2 flex items-center gap-2'>
          <div className={cn("w-2 h-2 rounded-full animate-pulse", timeLeft < 10 ? "bg-red-500" : "bg-green-500")} />
          <span className={cn("font-mono font-bold", timeLeft < 10 ? "text-red-500" : "text-zinc-400")}>
            {timeLeft}s
          </span>
        </div>
        
        <button 
          onClick={handleCancelOrder}
          className='bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-full p-3 transition-colors active:scale-95'
        >
          <X className='w-6 h-6' />
        </button>
      </div>

      <div className='flex items-center gap-6 mb-12 mt-8'>
        <button
          onClick={() => navigate('/basket')}
          className='p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white'
        >
          <ArrowLeft className='w-8 h-8' />
        </button>
        <h1 className='text-4xl font-bold'>PAYMENT</h1>
      </div>

      <div className='flex-1 grid grid-cols-2 gap-8'>
        {/* Card Payment */}
        <button 
          onClick={() => handlePayment('card')}
          disabled={processingMethod !== null}
          className={cn(
            'bg-zinc-900 rounded-3xl border-2 p-8 flex flex-col items-center justify-center gap-8 relative overflow-hidden group transition-all active:scale-95',
            processingMethod === 'card' ? 'border-purple-500 bg-zinc-800' : 'border-zinc-800 hover:border-purple-500/50',
            processingMethod && processingMethod !== 'card' ? 'opacity-50 cursor-not-allowed' : ''
          )}
        >
          {processingMethod === 'card' && (
            <div className="absolute inset-0 bg-purple-500/10 flex items-center justify-center z-20 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-16 h-16 text-purple-400 animate-spin" />
                <span className="text-xl font-bold text-white">Processing...</span>
              </div>
            </div>
          )}
          
          <div className='absolute inset-0 bg-linear-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity' />

          <div className='w-48 h-48 rounded-full bg-zinc-950 flex items-center justify-center border-4 border-zinc-800 shadow-[0_0_30px_rgba(147,51,234,0.2)]'>
            <CreditCard className='w-24 h-24 text-purple-400' />
          </div>

          <div className='text-center z-10'>
            <h2 className='text-3xl font-bold mb-2'>Card Payment</h2>
            <p className='text-xl text-zinc-400'>Tap to pay with card</p>
          </div>
        </button>

        {/* QR Payment */}
        <button 
          onClick={() => handlePayment('qr')}
          disabled={processingMethod !== null}
          className={cn(
            'bg-zinc-900 rounded-3xl border-2 p-8 flex flex-col items-center justify-center gap-8 relative overflow-hidden group transition-all active:scale-95',
            processingMethod === 'qr' ? 'border-green-500 bg-zinc-800' : 'border-zinc-800 hover:border-green-500/50',
            processingMethod && processingMethod !== 'qr' ? 'opacity-50 cursor-not-allowed' : ''
          )}
        >
          {processingMethod === 'qr' && (
            <div className="absolute inset-0 bg-green-500/10 flex items-center justify-center z-20 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-16 h-16 text-green-400 animate-spin" />
                <span className="text-xl font-bold text-white">Scanning...</span>
              </div>
            </div>
          )}

          <div className='absolute inset-0 bg-linear-to-br from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity' />

          <div className='w-48 h-48 bg-white p-4 rounded-2xl flex items-center justify-center'>
            <QrCode className='w-full h-full text-black' />
          </div>

          <div className='text-center z-10'>
            <h2 className='text-3xl font-bold mb-2'>QR Payment</h2>
            <p className='text-xl text-zinc-400'>Tap to scan QR code</p>
          </div>
        </button>
      </div>

      <p className='text-center text-zinc-500 text-xl mt-8'>
        Select a payment method to proceed
      </p>
    </div>
  );
}
