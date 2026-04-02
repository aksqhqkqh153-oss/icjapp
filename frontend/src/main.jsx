import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'

const rootElement = document.getElementById('root')
const bootSplash = document.getElementById('boot-splash')

const root = ReactDOM.createRoot(rootElement)
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

requestAnimationFrame(() => {
  window.setTimeout(() => {
    if (!bootSplash) return
    bootSplash.classList.add('hidden')
    window.setTimeout(() => bootSplash.remove(), 320)
  }, 180)
})
