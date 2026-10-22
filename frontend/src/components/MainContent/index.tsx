'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();

  return (
    <main 
      className={`flex-1 min-w-0 transition-[margin] duration-300 ${
        isCollapsed ? 'ml-14' : 'ml-60'
      }`}
    >
      {children}
    </main>
  );
};

export default MainContent;
