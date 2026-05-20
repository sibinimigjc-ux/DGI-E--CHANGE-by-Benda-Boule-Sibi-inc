// This is a TS wrapper for the config to appease the linter
import config from '../../firebase-applet-config.json';
export default config;
// Ajoute ceci à la fin de ton fichier
export const checkFirstLogin = (userProfile: any) => {
  // Si le profil existe mais n'a pas encore défini de mot de passe interne
  return userProfile?.isNew === true || !userProfile?.internalPassword;
};