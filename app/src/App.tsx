import { type ReactElement, useState } from "react";
import { SignedIn, SignedOut, SignInPage } from "@/auth";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import TestingPage from "./pages/TestingPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import GoalsPage from "./pages/GoalsPage";
import ProfilePage from "./pages/ProfilePage";
import { AdminQuestionsPage, AdminAlgorithmPage, AdminCalendarPage } from "./pages/AdminPage";
import SavedQuestionsPage from "./pages/SavedQuestionsPage";
import StudyPlanPage from "./pages/StudyPlanPage";

type Page =
  | "home"
  | "testing"
  | "analytics"
  | "goals"
  | "study-plans"
  | "profile"
  | "admin-questions"
  | "admin-algorithm"
  | "admin-calendar"
  | "saved";

function renderPage(page: Page): ReactElement {
  switch (page) {
    case "testing":
      return <TestingPage />;
    case "analytics":
      return <AnalyticsPage />;
    case "goals":
      return <GoalsPage />;
    case "study-plans":
      return <StudyPlanPage />;
    case "profile":
      return <ProfilePage />;
    case "admin-questions":
      return <AdminQuestionsPage />;
    case "admin-algorithm":
      return <AdminAlgorithmPage />;
    case "admin-calendar":
      return <AdminCalendarPage />;
    case "saved":
      return <SavedQuestionsPage />;
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
