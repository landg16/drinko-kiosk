import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generalStore } from '@/store/general-store.ts';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { ConfirmationModal } from './confirmation-modal';

export function InactivityTimer() {
  const navigate = useNavigate();
  const clearCart = generalStore((state) => state.clearCart);
  const cart = generalStore((state) => state.cart);
  const [timeLeft, setTimeLeft] = useState(60);
  const [showCancelModal, setShowCancelModal] = useState(false);

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

    const resetTimer = () => setTimeLeft(60);
    window.addEventListener('click', resetTimer);
    window.addEventListener('touchstart', resetTimer);

    return () => {
      clearInterval(timer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
    };
  }, [navigate, clearCart]);

  const handleCancelClick = () => {
    if (cart.length > 0) {
      setShowCancelModal(true);
    } else {
      clearCart();
      navigate('/');
    }
  };

  const confirmCancel = () => {
    clearCart();
    navigate('/');
  };

  return (
    <>
      <div className='absolute top-0 right-0 p-6 z-30 flex items-center gap-4'>
        <div className='bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-full px-4 py-2 flex items-center gap-2'>
          <div className={cn("w-2 h-2 rounded-full animate-pulse", timeLeft < 10 ? "bg-red-500" : "bg-green-500")} />
          <span className={cn("font-mono font-bold", timeLeft < 10 ? "text-red-500" : "text-zinc-400")}>
            {timeLeft}s
          </span>
        </div>
        
        <button 
          onClick={handleCancelClick}
          className='bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-full p-3 transition-colors active:scale-95'
        >
          <X className='w-6 h-6' />
        </button>
      </div>

      <ConfirmationModal 
        isOpen={showCancelModal}
        onConfirm={confirmCancel}
        onCancel={() => setShowCancelModal(false)}
      />
    </>
  );
}
