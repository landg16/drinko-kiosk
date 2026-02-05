import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generalStore } from '@/store/general-store.ts';
import { categories, drinks } from '@/data/drinks';
import { cn } from '@/lib/utils';
import {
  Beer,
  Zap,
  GlassWater,
  Martini,
  type LucideIcon,
  Trash2,
  Edit2,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/shared/confirmation-modal';

const categoryIcons: Record<string, LucideIcon> = {
  Shots: GlassWater,
  Mixes: Martini,
  'Energy Mixes': Zap,
  'Soft Drinks': Beer,
};

export function MenuPage() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState(categories[0]);
  const openDrinkModal = generalStore((state) => state.openDrinkModal);
  const cart = generalStore((state) => state.cart);
  const removeFromCart = generalStore((state) => state.removeFromCart);
  const clearCart = generalStore((state) => state.clearCart);
  const [timeLeft, setTimeLeft] = useState(60); // 60 seconds timeout
  const [showCancelModal, setShowCancelModal] = useState(false);

  const filteredDrinks = drinks.filter((d) => d.category === activeCategory);

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
    <div className='h-full w-full flex flex-col bg-zinc-950 text-white relative'>
      {/* Top Bar with Timer and Cancel */}
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

      <div className='flex-1 flex overflow-hidden'>
        {/* Left Sidebar - Categories */}
        <div className='w-[30%] h-full border-r border-zinc-800 bg-zinc-900/50 flex flex-col pt-20'>
          <div className='p-6 border-b border-zinc-800'>
            <h2 className='text-2xl font-bold text-purple-400'>MENU</h2>
          </div>

          <div className='flex-1 overflow-y-auto'>
            {categories.map((cat) => {
              const Icon = categoryIcons[cat] || GlassWater;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    'w-full p-8 text-left flex items-center gap-4 transition-all border-l-4',
                    activeCategory === cat
                      ? 'bg-zinc-800 border-purple-500 text-white'
                      : 'border-transparent text-zinc-400 active:bg-zinc-800/50',
                  )}
                >
                  <Icon
                    className={cn(
                      'w-8 h-8',
                      activeCategory === cat ? 'text-purple-400' : 'text-zinc-600',
                    )}
                  />
                  <span className='text-2xl font-semibold'>{cat}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Content - Drink Grid */}
        <div className='w-[70%] h-full p-8 bg-zinc-950 overflow-y-auto pb-40 pt-24'>
          <div className='grid grid-cols-2 gap-6'>
            {filteredDrinks.map((drink) => {
              // Check if this drink is already in the cart
              const existingCartItem = cart.find((item) => item.id === drink.id);

              return (
                <button
                  key={drink.id}
                  onClick={() => {
                    // If it's in the cart, open modal in edit mode for that item
                    if (existingCartItem) {
                      openDrinkModal(drink, existingCartItem);
                    } else {
                      openDrinkModal(drink);
                    }
                  }}
                  className={cn(
                    'relative group h-48 bg-zinc-900 rounded-2xl border p-6 flex flex-col justify-between items-start active:bg-zinc-800 transition-all active:scale-95',
                    existingCartItem
                      ? 'border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                      : 'border-zinc-800 active:border-purple-500/50',
                  )}
                >
                  {/* "In Basket" Indicator Badge */}
                  {existingCartItem && (
                    <div className='absolute top-4 right-4 bg-purple-600 text-white p-1.5 rounded-full shadow-lg animate-in zoom-in duration-200 z-10'>
                      <Check className='w-5 h-5' />
                    </div>
                  )}

                  <div className='w-full flex justify-between items-start'>
                    <div
                      className={cn(
                        'p-3 rounded-full border transition-colors',
                        existingCartItem
                          ? 'bg-purple-500/10 border-purple-500/50'
                          : 'bg-zinc-950 border-zinc-800 group-active:border-purple-500/30',
                      )}
                    >
                      <Martini
                        className={cn(
                          'w-8 h-8',
                          existingCartItem ? 'text-purple-300' : 'text-purple-400',
                        )}
                      />
                    </div>
                  </div>

                  <div className='w-full flex justify-between items-end'>
                    <div className='text-left'>
                      <h3 className='text-2xl font-bold mb-1'>{drink.name}</h3>
                      <p className='text-xl text-purple-400 font-mono'>${drink.price}</p>
                    </div>

                    {/* Strength Indicator (Moved to bottom right) */}
                    <div className='flex gap-1 mb-1'>
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            'w-2 h-6 rounded-full',
                            i < drink.strength ? 'bg-purple-500' : 'bg-zinc-800',
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Basket Bar */}
      {cart.length > 0 && (
        <div className='h-32 bg-zinc-900 border-t border-zinc-800 flex items-center px-6 gap-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20'>
          <div className='flex-1 overflow-x-auto flex items-center gap-4 no-scrollbar py-2'>
            {cart.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className='shrink-0 w-72 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center justify-between group'
              >
                <div className='flex flex-col'>
                  <span className='font-bold text-lg truncate max-w-35'>{item.name}</span>
                  <div className='flex items-center gap-2'>
                    <span className='text-purple-400 font-mono'>
                      ${(item.isDouble ? item.price * 1.8 : item.price).toFixed(2)}
                    </span>
                    {item.isDouble && (
                      <span className='text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30'>
                        DBL
                      </span>
                    )}
                    {item.quantity > 1 && (
                      <span className='text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full border border-zinc-700'>
                        x{item.quantity}
                      </span>
                    )}
                  </div>
                </div>

                <div className='flex items-center gap-2'>
                  {/* Edit Button - Re-opens modal for this drink */}
                  <button
                    onClick={() => openDrinkModal(item, item)}
                    className='p-3 bg-zinc-800 rounded-lg text-zinc-400 active:text-white active:bg-zinc-700'
                  >
                    <Edit2 className='w-5 h-5' />
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={() => removeFromCart(index)}
                    className='p-3 bg-red-500/10 rounded-lg text-red-500 active:bg-red-500 active:text-white'
                  >
                    <Trash2 className='w-5 h-5' />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className='flex items-center gap-6 pl-6 border-l border-zinc-800 h-full'>
            <div className='flex flex-col items-end'>
              <span className='text-zinc-400 text-sm uppercase tracking-wider'>Total</span>
              <span className='text-3xl font-bold text-purple-400 font-mono'>
                $
                {cart
                  .reduce(
                    (sum, item) =>
                      sum + (item.isDouble ? item.price * 1.8 : item.price) * item.quantity,
                    0,
                  )
                  .toFixed(2)}
              </span>
            </div>

            <Button
              onClick={() => navigate('/payment')}
              className='h-20 px-8 text-xl font-bold bg-purple-600 hover:bg-purple-500 active:scale-95 rounded-xl shadow-[0_0_20px_rgba(147,51,234,0.3)] flex items-center gap-3'
            >
              PAY NOW
              <ChevronRight className='w-6 h-6' />
            </Button>
          </div>
        </div>
      )}

      <ConfirmationModal 
        isOpen={showCancelModal}
        onConfirm={confirmCancel}
        onCancel={() => setShowCancelModal(false)}
      />
    </div>
  );
}
