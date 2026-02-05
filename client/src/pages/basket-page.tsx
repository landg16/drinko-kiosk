import { useNavigate } from 'react-router-dom';
import { generalStore } from '@/store/general-store.ts';
import { Button } from '@/components/ui/button';
import { Trash2, ArrowLeft } from 'lucide-react';

export function BasketPage() {
  const navigate = useNavigate();
  const { cart, removeFromCart } = generalStore();

  const total = cart.reduce((sum, item) => {
    const price = item.isDouble ? item.price * 1.8 : item.price;
    return sum + price;
  }, 0);

  return (
    <div className='h-full w-full flex flex-col bg-zinc-950 text-white p-8'>
      <div className='flex items-center gap-6 mb-8'>
        <button
          onClick={() => navigate('/menu')}
          className='p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-purple-500'
        >
          <ArrowLeft className='w-8 h-8' />
        </button>
        <h1 className='text-4xl font-bold'>Your Order</h1>
      </div>

      <div className='flex-1 overflow-y-auto space-y-4 pr-2'>
        {cart.map((item, index) => (
          <div
            key={`${item.id}-${index}`}
            className='flex items-center justify-between p-6 bg-zinc-900 rounded-2xl border border-zinc-800'
          >
            <div>
              <h3 className='text-2xl font-bold'>{item.name}</h3>
              {item.isDouble && (
                <span className='inline-block mt-2 px-3 py-1 bg-purple-500/20 text-purple-400 text-sm font-bold rounded-full border border-purple-500/30'>
                  DOUBLE
                </span>
              )}
            </div>

            <div className='flex items-center gap-6'>
              <span className='text-2xl font-mono text-zinc-300'>
                ${(item.isDouble ? item.price * 1.8 : item.price).toFixed(2)}
              </span>
              <button
                onClick={() => removeFromCart(index)}
                className='p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-colors'
              >
                <Trash2 className='w-6 h-6' />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className='mt-8 pt-8 border-t border-zinc-800'>
        <div className='flex justify-between items-end mb-8'>
          <span className='text-2xl text-zinc-400'>Total</span>
          <span className='text-5xl font-bold text-purple-400 font-mono'>${total.toFixed(2)}</span>
        </div>

        <Button
          size='lg'
          className='w-full h-24 text-3xl font-bold bg-green-600 hover:bg-green-500 rounded-2xl shadow-[0_0_30px_rgba(22,163,74,0.4)] animate-pulse'
          onClick={() => navigate('/payment')}
          disabled={cart.length === 0}
        >
          PROCEED TO PAYMENT
        </Button>
      </div>
    </div>
  );
}
