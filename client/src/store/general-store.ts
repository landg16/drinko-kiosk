import { create } from 'zustand'

export type Drink = {
  id: string
  name: string
  category: string
  price: number
  strength: 1 | 2 | 3
  image?: string
}

export type CartItem = Drink & {
  isDouble: boolean
  quantity: number
  cartId: string // Unique ID for the cart item to distinguish duplicates/edits
}

interface GeneralState {
  cart: CartItem[]
  selectedDrink: Drink | null
  editingCartItem: CartItem | null // Track if we are editing an existing item
  isDrinkModalOpen: boolean
  
  addToCart: (drink: Drink, isDouble: boolean, quantity: number) => void
  updateCartItem: (cartId: string, isDouble: boolean, quantity: number) => void
  removeFromCart: (index: number) => void
  clearCart: () => void
  openDrinkModal: (drink: Drink, cartItem?: CartItem) => void
  closeDrinkModal: () => void
}

export const generalStore = create<GeneralState>((set) => ({
  cart: [],
  selectedDrink: null,
  editingCartItem: null,
  isDrinkModalOpen: false,

  addToCart: (drink, isDouble, quantity) => set((state) => ({
    cart: [...state.cart, { ...drink, isDouble, quantity, cartId: crypto.randomUUID() }],
    isDrinkModalOpen: false,
    selectedDrink: null,
    editingCartItem: null
  })),

  updateCartItem: (cartId, isDouble, quantity) => set((state) => ({
    cart: state.cart.map(item => 
      item.cartId === cartId 
        ? { ...item, isDouble, quantity }
        : item
    ),
    isDrinkModalOpen: false,
    selectedDrink: null,
    editingCartItem: null
  })),

  removeFromCart: (index) => set((state) => ({
    cart: state.cart.filter((_, i) => i !== index)
  })),

  clearCart: () => set({ cart: [] }),

  openDrinkModal: (drink, cartItem) => set({ 
    selectedDrink: drink, 
    editingCartItem: cartItem || null,
    isDrinkModalOpen: true 
  }),
  
  closeDrinkModal: () => set({ 
    selectedDrink: null, 
    editingCartItem: null,
    isDrinkModalOpen: false 
  }),
}))
