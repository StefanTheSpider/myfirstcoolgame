import { createContext, useContext, useState } from "react";
import lang from "./lang";

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(
    () => localStorage.getItem("language") || "de"
  );

  const toggleLanguage = () => {
    const next = language === "de" ? "en" : "de";
    localStorage.setItem("language", next);
    setLanguage(next);
  };

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t: lang[language] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
