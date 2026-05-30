import { type ReactElement, useState } from "react";
import { SignedIn, SignedOut, SignInPage } from "@/auth";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import TestingPage from "./pages/TestingPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import GoalsPage from "./pages/GoalsPage";
import ProfilePage from "./pages/ProfilePage";

type Page = "home" | "testing" | "analytics" | "goals" | "profile";

function renderPage(page: Page): ReactElement {
  switch (page) {
    case "testing":
      return <TestingPage />;
    case "analytics":
      return <AnalyticsPage />;
    case "goals":
      return <GoalsPage />;
    case "profile":
      return <ProfilePage />;
    case "home":
      return <HomePage />;
  }
}

export default function App(): ReactElement {
  const [currentPage, setCurrentPage] = useState<Page>("home");

  return (
    <>
      <SignedOut>
        <SignInPage />
      </SignedOut>
      <SignedIn>
        <Layout
          currentPage={currentPage}
          onPageChange={(page) => {
            setCurrentPage(page as Page);
          }}
        >
          {renderPage(currentPage)}
        </Layout>
      </SignedIn>
    </>
  );
}
