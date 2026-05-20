// src/lib/resend-service.ts

export const sendInvitationEmail = async (email: string, role: string) => {
  const RESEND_API_KEY = 're_bXscnomn_K7mbWthL1jnkieSw7jZ2snMn';
  
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev', // Garde ça pour le test, change après validation du domaine
        to: email,
        subject: 'Accès Portail DGI E-ECHANGE',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee;">
            <h2 style="color: #e53e3e;">Bienvenue sur le Portail DGI</h2>
            <p>Bonjour,</p>
            <p>Votre accès a été configuré avec le rôle : <strong>${role}</strong>.</p>
            <p>Veuillez vous connecter avec votre compte Google professionnel pour activer votre session.</p>
            <br>
            <p>Cordialement,<br>L'Administration DGI</p>
          </div>
        `
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || "Erreur lors de l'envoi du mail");
    }

    return { success: true, data };
  } catch (error) {
    console.error("Erreur service Resend:", error);
    return { success: false, error };
  }
};