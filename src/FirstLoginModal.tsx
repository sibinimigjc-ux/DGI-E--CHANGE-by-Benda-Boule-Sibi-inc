import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './lib/firebase';

export const FirstLoginModal = ({ user, onComplete }: { user: any, onComplete: () => void }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSave = async () => {
    if (password !== confirm || password.length < 6) {
      alert("Les mots de passe ne correspondent pas ou sont trop courts (min 6).");
      return;
    }
    
    const userRef = doc(db, 'utilisateurs', user.uid);
    await updateDoc(userRef, {
      internalPassword: password,
      isNew: false // On désactive le mode "nouveau"
    });
    onComplete(); // On débloque l'accès à l'app
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 9999,
      display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white'
    }}>
      <div style={{ backgroundColor: '#1a1a1a', padding: '40px', borderRadius: '15px', textAlign: 'center', maxWidth: '400px' }}>
        <h2 style={{ color: '#e53e3e' }}>🛡️ Sécurisez votre accès</h2>
        <p>C'est votre première connexion. Veuillez définir votre mot de passe interne pour le portail DGI.</p>
        <input 
          type="password" placeholder="Nouveau mot de passe" 
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', padding: '10px', margin: '10px 0', borderRadius: '5px', border: 'none' }}
        />
        <input 
          type="password" placeholder="Confirmez le mot de passe" 
          onChange={(e) => setConfirm(e.target.value)}
          style={{ width: '100%', padding: '10px', margin: '10px 0', borderRadius: '5px', border: 'none' }}
        />
        <button 
          onClick={handleSave}
          style={{ backgroundColor: '#e53e3e', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', marginTop: '15px' }}
        >
          Valider et accéder au portail
        </button>
      </div>
    </div>
  );
};