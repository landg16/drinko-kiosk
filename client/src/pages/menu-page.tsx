import { useState } from 'react';
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
  LayoutGrid,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InactivityTimer } from '@/components/shared/inactivity-timer';

const categoryIcons: Record<string, LucideIcon> = {
  All: LayoutGrid,
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

  const filteredDrinks = activeCategory === 'All' 
    ? drinks 
    : drinks.filter((d) => d.category === activeCategory);

  // Group cart items by drink ID to display consolidated cards
  const groupedCart = cart.reduce((acc, item) => {
    if (!acc[item.id]) {
      acc[item.id] = {
        ...item,
        regularQuantity: 0,
        doubleQuantity: 0,
        totalPrice: 0
      };
    }
    
    if (item.isDouble) {
      acc[item.id].doubleQuantity += item.quantity;
    } else {
      acc[item.id].regularQuantity += item.quantity;
    }
    
    const itemPrice = item.isDouble ? item.price * 1.8 : item.price;
    acc[item.id].totalPrice += itemPrice * item.quantity;
    
    return acc;
  }, {} as Record<string, any>);

  const groupedCartItems = Object.values(groupedCart);

  return (
    <div className='h-full w-full flex flex-col bg-zinc-950 text-white relative'>
      <InactivityTimer />

      <div className='flex-1 flex overflow-hidden'>
        {/* Left Sidebar - Categories */}
        <div className='w-[30%] h-full border-r border-zinc-800 bg-zinc-900/50 flex flex-col'>
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
                    'relative group h-96 bg-zinc-900 rounded-2xl border flex flex-col justify-between items-start active:bg-zinc-800 transition-all active:scale-95 overflow-hidden',
                    existingCartItem
                      ? 'border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                      : 'border-zinc-800 active:border-purple-500/50',
                  )}
                >
                  {/* Background Image */}
                  {drink.image && (
                    <div className="absolute inset-0 z-0">
                      <img 
                        src={drink.image} 
                        alt={drink.name} 
                        className="w-full h-full object-cover opacity-40 group-active:opacity-30 transition-opacity"
                      />
                      <div className="absolute inset-0 bg-linear-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
                    </div>
                  )}

                  {/* "In Basket" Indicator Badge */}
                  {existingCartItem && (
                    <div className='absolute top-4 right-4 bg-purple-600 text-white p-1.5 rounded-full shadow-lg animate-in zoom-in duration-200 z-10'>
                      <Check className='w-5 h-5' />
                    </div>
                  )}

                  <div className='w-full flex justify-between items-start p-6 z-10'>
                    <div
                      className={cn(
                        'p-3 rounded-full border transition-colors backdrop-blur-sm',
                        existingCartItem
                          ? 'bg-purple-500/20 border-purple-500/50'
                          : 'bg-zinc-950/50 border-zinc-800 group-active:border-purple-500/30',
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

                  <div className='w-full flex justify-between items-end p-6 z-10 mt-auto'>
                    <div className='text-left'>
                      <h3 className='text-2xl font-bold mb-1 drop-shadow-md'>{drink.name}</h3>
                      <p className='text-xl text-purple-400 font-mono font-bold drop-shadow-md'>${drink.price}</p>
                    </div>

                    {/* Strength Indicator (Moved to bottom right) */}
                    <div className='flex gap-1 mb-1'>
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            'w-2 h-6 rounded-full shadow-sm',
                            i < drink.strength ? 'bg-purple-500' : 'bg-zinc-800/80',
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
        <div className='h-40 bg-zinc-900 border-t border-zinc-800 flex items-center px-6 gap-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20'>
          <div className='flex-1 overflow-x-auto flex items-center gap-4 no-scrollbar py-2 h-full'>
            {groupedCartItems.map((item) => (
              <div
                key={item.id}
                className='shrink-0 w-80 h-32 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center justify-between group relative overflow-hidden'
              >
                {/* Background Image for Basket Item */}
                {item.image && (
                  <div className="absolute inset-0 z-0 opacity-20">
                    <img src={item.image} alt="" className="w-full h-full object-cover" />
                  </div>
                )}

                <div className='flex flex-col z-10 flex-1 mr-4'>
                  <span className='font-bold text-lg truncate'>{item.name}</span>
                  <span className='text-purple-400 font-mono font-bold mb-2'>
                    ${item.totalPrice.toFixed(2)}
                  </span>
                  
                  <div className='flex flex-wrap gap-2'>
                    {item.regularQuantity > 0 && (
                      <span className='text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded-md border border-zinc-700 font-medium'>
                        Regular: x{item.regularQuantity}
                      </span>
                    )}
                    {item.doubleQuantity > 0 && (
                      <span className='text-xs bg-purple-500/20 text-purple-300 px-2 py-1 rounded-md border border-purple-500/30 font-medium'>
                        Double: x{item.doubleQuantity}
                      </span>
                    )}
                  </div>
                </div>

                <div className='flex flex-col gap-2 z-10'>
                  {/* Edit Button */}
                  <button
                    onClick={() => openDrinkModal(item, item)}
                    className='p-2.5 bg-zinc-800 rounded-lg text-zinc-400 active:text-white active:bg-zinc-700 border border-zinc-700'
                  >
                    <Edit2 className='w-5 h-5' />
                  </button>

                  {/* Delete Button (Removes ALL of this drink type) */}
                  <button
                    onClick={() => {
                      // Find all items with this ID and remove them
                      const indicesToRemove: number[] = [];
                      cart.forEach((c, idx) => {
                        if (c.id === item.id) indicesToRemove.push(idx);
                      });
                      
                      // Sort descending to remove from end first
                      indicesToRemove.sort((a, b) => b - a).forEach(idx => {
                        removeFromCart(idx);
                      });
                    }}
                    className='p-2.5 bg-red-500/10 rounded-lg text-red-500 active:bg-red-500 active:text-white border border-red-500/20'
                  >
                    <Trash2 className='w-5 h-5' />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className='flex items-center gap-6 pl-6 border-l border-zinc-800 h-full bg-zinc-900 z-20'>
            <div className='flex flex-col items-end'>
              <span className='text-zinc-400 text-sm uppercase tracking-wider'>Total</span>
              <span className='text-4xl font-bold text-purple-400 font-mono'>
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
              className='h-24 px-10 text-2xl font-bold bg-purple-600 hover:bg-purple-500 active:scale-95 rounded-2xl shadow-[0_0_20px_rgba(147,51,234,0.3)] flex items-center gap-3'
            >
              PAY NOW
              <ChevronRight className='w-8 h-8' />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
