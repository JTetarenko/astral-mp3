import { createRoot } from 'react-dom/client'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource/orbitron/600.css'
import '@fontsource/orbitron/800.css'
import '@fontsource/orbitron/900.css' // damage-numeral black weight
import './styles.css'
import { App } from './App'

// No StrictMode: double-mounting fights the AudioContext/pointer-lock singletons.
createRoot(document.getElementById('root')!).render(<App />)
