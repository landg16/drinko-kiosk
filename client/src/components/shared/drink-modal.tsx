import { generalStore } from '@/store/general-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useState, useEffect } from 'react'
import { X, AlertCircle, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DrinkModal() {
  const { 
    selectedDrink, 
    editingCartItem, 
    isDrinkModalOpen, 
    closeDrinkModal, 
    addToCart, 
    updateCartItem,
    cart 
  } = generalStore()
  
  // Split quantities for regular and double
  const [regularQuantity, setRegularQuantity] = useState(0)
  const [doubleQuantity, setDoubleQuantity] = useState(0)

  // Find ALL cart items for this drink (both regular and double)
  const existingItems = cart.filter(item => item.id === selectedDrink?.id)
  
  // Check if this drink is already in the cart (excluding the ones being edited)
  // This is mostly for the "Already in basket" warning if we are adding NEW items
  const isAlreadyInBasket = existingItems.length > 0 && !editingCartItem

  // Initialize state when modal opens
  useEffect(() => {
    if (isDrinkModalOpen && selectedDrink) {
      // Always initialize from the TOTAL state of the cart for this drink ID
      // This fixes the issue where clicking "1 Gin Tonic" in the basket (which might be the Regular item)
      // would only show the Regular quantity if we relied on editingCartItem.
      // By looking at existingItems, we see the full picture.
      
      const regularItem = existingItems.find(i => !i.isDouble)
      const doubleItem = existingItems.find(i => i.isDouble)
      
      setRegularQuantity(regularItem ? regularItem.quantity : 0)
      setDoubleQuantity(doubleItem ? doubleItem.quantity : 0)
      
      // If it's a fresh add (no existing items), default to 1 Regular
      if (existingItems.length === 0) {
        setRegularQuantity(1)
        setDoubleQuantity(0)
      }
    }
  }, [isDrinkModalOpen, selectedDrink]) // Removed editingCartItem dependency to rely on cart state

  if (!isDrinkModalOpen || !selectedDrink) return null

  const totalQuantity = regularQuantity + doubleQuantity
  const maxQuantity = 10
  const canAdd = totalQuantity < maxQuantity

  const regularPrice = selectedDrink.price
  const doublePrice = selectedDrink.price * 1.8
  
  const totalPrice = (regularPrice * regularQuantity) + (doublePrice * doubleQuantity)

  const handleSave = () => {
    const { removeFromCart } = generalStore.getState()

    // Helper to remove item
    const removeItem = (item: any) => {
       const currentCart = generalStore.getState().cart
       const idx = currentCart.findIndex(i => i.cartId === item.cartId)
       if (idx !== -1) removeFromCart(idx)
    }

    // 1. Handle Regular
    const existingRegular = existingItems.find(i => !i.isDouble)
    if (regularQuantity > 0) {
      if (existingRegular) {
        updateCartItem(existingRegular.cartId, false, regularQuantity)
      } else {
        addToCart(selectedDrink, false, regularQuantity)
      }
    } else if (existingRegular) {
      removeItem(existingRegular)
    }

    // 2. Handle Double
    const existingDouble = existingItems.find(i => i.isDouble)
    if (doubleQuantity > 0) {
      if (existingDouble) {
        updateCartItem(existingDouble.cartId, true, doubleQuantity)
      } else {
        addToCart(selectedDrink, true, doubleQuantity)
      }
    } else if (existingDouble) {
      removeItem(existingDouble)
    }
    
    closeDrinkModal()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl relative flex flex-col max-h-[90vh]">
        <button 
          onClick={closeDrinkModal}
          className="absolute top-6 right-6 p-2 bg-zinc-800 rounded-full text-zinc-400 active:text-white z-10"
        >
          <X className="w-8 h-8" />
        </button>

        <div className="flex flex-col gap-8 h-full">
          <div>
            <h2 className="text-4xl font-bold text-white mb-2">{selectedDrink.name}</h2>
            <div className="flex items-center gap-4">
              <p className="text-2xl text-purple-400 font-mono">${totalPrice.toFixed(2)}</p>
              {isAlreadyInBasket && (
                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                  <AlertCircle className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm text-yellow-500 font-medium">Already in basket</span>
                </div>
              )}
            </div>
          </div>

          {/* Dual Quantity Selectors */}
          <div className="flex flex-col gap-6">
            
            {/* Regular Row */}
            <div className="flex items-center justify-between p-6 bg-zinc-950 rounded-2xl border border-zinc-800">
              <div className="flex flex-col">
                <span className="text-2xl font-semibold text-white">Regular</span>
                <span className="text-zinc-500">${regularPrice.toFixed(2)}</span>
              </div>
              
              <div className="flex items-center gap-6">
                <button 
                  onClick={() => setRegularQuantity(Math.max(0, regularQuantity - 1))}
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all",
                    regularQuantity > 0 
                      ? "border-zinc-700 bg-zinc-900 text-white active:scale-95" 
                      : "border-zinc-800 bg-zinc-950 text-zinc-700"
                  )}
                  disabled={regularQuantity === 0}
                >
                  <Minus className="w-6 h-6" />
                </button>
                
                <span className={cn(
                  "text-4xl font-bold w-12 text-center font-mono",
                  regularQuantity > 0 ? "text-white" : "text-zinc-700"
                )}>
                  {regularQuantity}
                </span>
                
                <button 
                  onClick={() => canAdd && setRegularQuantity(regularQuantity + 1)}
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all",
                    canAdd
                      ? "border-purple-500 bg-purple-500/10 text-purple-400 active:bg-purple-500 active:text-white active:scale-95" 
                      : "border-zinc-800 bg-zinc-950 text-zinc-700 opacity-50"
                  )}
                  disabled={!canAdd}
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Double Row */}
            <div className="flex items-center justify-between p-6 bg-zinc-950 rounded-2xl border border-zinc-800">
              <div className="flex flex-col">
                <span className="text-2xl font-semibold text-white">Double</span>
                <span className="text-purple-400 font-medium">Stronger • ${doublePrice.toFixed(2)}</span>
              </div>
              
              <div className="flex items-center gap-6">
                <button 
                  onClick={() => setDoubleQuantity(Math.max(0, doubleQuantity - 1))}
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all",
                    doubleQuantity > 0 
                      ? "border-zinc-700 bg-zinc-900 text-white active:scale-95" 
                      : "border-zinc-800 bg-zinc-950 text-zinc-700"
                  )}
                  disabled={doubleQuantity === 0}
                >
                  <Minus className="w-6 h-6" />
                </button>
                
                <span className={cn(
                  "text-4xl font-bold w-12 text-center font-mono",
                  doubleQuantity > 0 ? "text-white" : "text-zinc-700"
                )}>
                  {doubleQuantity}
                </span>
                
                <button 
                  onClick={() => canAdd && setDoubleQuantity(doubleQuantity + 1)}
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all",
                    canAdd
                      ? "border-purple-500 bg-purple-500/10 text-purple-400 active:bg-purple-500 active:text-white active:scale-95" 
                      : "border-zinc-800 bg-zinc-950 text-zinc-700 opacity-50"
                  )}
                  disabled={!canAdd}
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>

          {/* Total Counter */}
          <div className="flex justify-center">
             <p className="text-zinc-500 text-lg">
               Total items: <span className={cn("font-bold", totalQuantity === maxQuantity ? "text-red-500" : "text-white")}>{totalQuantity}</span> / {maxQuantity}
             </p>
          </div>

          <Button 
            size="lg"
            className="h-20 text-2xl font-bold bg-purple-600 hover:bg-purple-500 rounded-xl shadow-[0_0_20px_rgba(147,51,234,0.3)] mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={totalQuantity === 0}
          >
            {existingItems.length > 0 ? 'UPDATE ORDER' : 'ADD TO ORDER'}
          </Button>
        </div>
      </div>
    </div>
  )
}
