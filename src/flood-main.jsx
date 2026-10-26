import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Flood from './Flood.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Flood />
  </StrictMode>,
)
