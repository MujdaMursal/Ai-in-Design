import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Corridor from './Corridor.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Corridor />
  </StrictMode>,
)
