import { useNavigate } from 'react-router-dom';
import { generalStore } from '@/store/general-store.ts';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

export function CompletionPage() {
  const navigate = useNavigate();
  const { clearCart } = generalStore();

  const handleNewOrder = () => {
    clearCart();
    navigate('/');
  };

  return (
    <div className='h-full w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-12 relative overflow-hidden'>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-green-900/20 via-zinc-950 to-zinc-950' />

      <div className='z-10 flex flex-col items-center gap-12 animate-in fade-in zoom-in duration-500'>
        <div className='relative'>
          <div className='absolute inset-0 bg-green-500 blur-3xl opacity-20 animate-pulse' />
          <CheckCircle2 className='w-48 h-48 text-green-500 drop-shadow-[0_0_30px_rgba(34,197,94,0.5)]' />
        </div>

        <div className='text-center space-y-4'>
          <h1 className='text-6xl font-black text-white tracking-tight'>ORDER COMPLETE</h1>
          <p className='text-3xl text-zinc-400'>Please take your drinks</p>
        </div>

        <Button
          size='lg'
          className='h-24 px-16 text-3xl font-bold bg-white text-black hover:bg-zinc-200 rounded-full shadow-[0_0_40px_rgba(255,255,255,0.3)] transition-all hover:scale-105'
          onClick={handleNewOrder}
        >
          NEW ORDER
        </Button>
      </div>
    </div>
  );
}
