// app/admin/categories/page.tsx

import { fetchAllCategories } from "@/serverActions/noteCategoryActions";
import CategoryManageTable from "@/components/admin/categories/CategoryManageTable";

export default async function AdminCategoriesPage() {

  
  const categories = await fetchAllCategories();

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <CategoryManageTable categories={categories} />
    </div>
  );
}