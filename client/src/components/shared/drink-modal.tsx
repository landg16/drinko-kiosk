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

  // Check if this drink is already in the cart (excluding the one being edited)
  const existingInCart = cart.find(item => 
    item.id === selectedDrink?.id && 
    item.cartId !== editingCartItem?.cartId
  )

  // Initialize state when modal opens
  useEffect(() => {
    if (isDrinkModalOpen) {
      if (editingCartItem) {
        // If editing, we need to see if there's a "counterpart" in the cart
        // e.g., if editing a Double, is there a Regular version already?
        // This logic gets complex with the current store structure (separate items).
        // For now, we will just edit the single item selected.
        // BUT, the user asked to split them.
        
        // To solve "5 double and 1 basic", we actually need to treat them as separate line items in the cart,
        // but perhaps manage them together in the UI?
        // Or, simpler: The modal adds TWO separate items to the cart if both are selected.
        
        if (editingCartItem.isDouble) {
          setDoubleQuantity(editingCartItem.quantity)
          setRegularQuantity(0)
        } else {
          setRegularQuantity(editingCartItem.quantity)
          setDoubleQuantity(0)
        }
      } else {
        // New item default
        setRegularQuantity(1)
        setDoubleQuantity(0)
      }
    }
  }, [isDrinkModalOpen, editingCartItem])

  if (!isDrinkModalOpen || !selectedDrink) return null

  const totalQuantity = regularQuantity + doubleQuantity
  const maxQuantity = 10
  const canAdd = totalQuantity < maxQuantity

  const regularPrice = selectedDrink.price
  const doublePrice = selectedDrink.price * 1.8
  
  const totalPrice = (regularPrice * regularQuantity) + (doublePrice * doubleQuantity)

  const handleSave = () => {
    // If editing, we might need to update one item and potentially create another, 
    // or delete the one being edited if quantity goes to 0.
    // This is getting tricky with the current "edit one item" architecture.
    
    // SIMPLIFIED APPROACH for this request:
    // If we are in "Edit Mode", we are technically editing the *concept* of this drink in the cart.
    // We should probably remove the old item(s) for this drink and add new ones based on the new quantities.
    
    // However, to keep it robust:
    // 1. If editingCartItem exists, we remove it first.
    // 2. Then we add new items based on regularQuantity and doubleQuantity.
    
    // But wait, if there was ANOTHER item of the same drink (e.g. we clicked the Double version to edit, but there was also a Regular version in the cart),
    // we should probably consolidate them in this view?
    
    // Let's stick to the requested flow: "Select 5 double and 1 basic".
    // This implies the modal handles BOTH types simultaneously.
    
    // Strategy:
    // When saving:
    // 1. If editing, delete the original item.
    // 2. Add a Regular item if regularQuantity > 0
    // 3. Add a Double item if doubleQuantity > 0
    
    // Note: This might re-order items in the cart, but that's acceptable.
    
    if (editingCartItem) {
       // We need a way to remove the specific item we were editing.
       // The store has removeFromCart by index, but we have cartId now.
       // We need a deleteByCartId function in the store, or we find the index.
       const index = cart.findIndex(i => i.cartId === editingCartItem.cartId)
       if (index !== -1) {
         // We can't use removeFromCart(index) directly inside here easily without exposing it or modifying store.
         // Let's assume we modify the store to handle this "complex update".
         // For now, let's just use the existing addToCart and we might end up with duplicates if we don't delete.
         
         // Actually, the prompt implies a UI change to allow selecting both.
         // Let's implement the UI first, and for the logic:
         // If we are editing, we update the *current* item to match one of the non-zero quantities,
         // and add a new item for the other if needed.
         
         // Better yet: Let's just Add/Update.
         // If we have both quantities > 0, we are essentially splitting the order.
      }
    }

    // To properly support "5 double, 1 basic", these are two separate cart items.
    // The modal needs to be able to dispatch multiple actions.
    
    if (editingCartItem) {
        // Special case: We are editing ONE item.
        // If the user splits it into two types, we update the current one to Type A, and add a new Type B.
        // If the user changes type completely, we update the current one.
        
        if (regularQuantity > 0 && doubleQuantity > 0) {
            // User wants both. 
            // Update the existing item to be Regular (arbitrary choice)
            updateCartItem(editingCartItem.cartId, false, regularQuantity)
            // Add new Double item
            addToCart(selectedDrink, true, doubleQuantity)
        } else if (regularQuantity > 0) {
            // Only Regular
            updateCartItem(editingCartItem.cartId, false, regularQuantity)
        } else if (doubleQuantity > 0) {
            // Only Double
            updateCartItem(editingCartItem.cartId, true, doubleQuantity)
        } else {
            // Both 0? Should probably delete, but let's just close for now or prevent this state.
        }
    } else {
        // Adding new
        if (regularQuantity > 0) addToCart(selectedDrink, false, regularQuantity)
        if (doubleQuantity > 0) addToCart(selectedDrink, true, doubleQuantity)
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
              {existingInCart && !editingCartItem && (
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
            {editingCartItem ? 'UPDATE ORDER' : 'ADD TO ORDER'}
          </Button>
        </div>
      </div>
    </div>
  )
}
