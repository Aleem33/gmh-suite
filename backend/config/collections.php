<?php

declare(strict_types=1);

return [
    'allowed' => [
        'settings', 'plans', 'counters', 'schedules', 'users', 'patients',
        'appointments', 'consultations', 'prescriptionTemplates', 'admissions',
        'wards', 'rooms', 'beds', 'bedTreatments', 'labOrders', 'labTests',
        'bills', 'payments', 'staff', 'medicines', 'suppliers', 'purchases',
        'posPurchases', 'purchaseReturns', 'sales', 'saleReturns', 'posSales',
        'quotations', 'customers', 'customerPayments', 'approvalRequests',
        'expenses', 'posExpenses', 'pharmacyOrders', 'auditLogs', 'notifications',
    ],
    'indexes' => [
        '*' => [
            'date', 'createdAt', 'updatedAt', 'status', 'type', 'userId', 'requestedBy',
            'username', 'patientId', 'customerId', 'appointmentId', 'originalPurchaseId', 'originalSaleId',
        ],
        'appointments' => ['date', 'doctorId', 'patientId', 'status', 'tokenNo'],
        'approvalRequests' => ['status', 'type', 'requestedBy', 'createdAt'],
        'bedTreatments' => ['admissionId', 'patientId', 'type', 'createdAt', 'fulfillmentStatus'],
        'bills' => ['patientId', 'status', 'date', 'createdAt'],
        'customerPayments' => ['customerId', 'saleId', 'date', 'createdAt'],
        'expenses' => ['status', 'date', 'createdAt', 'createdBy'],
        'labOrders' => ['patientId', 'status', 'date', 'createdAt'],
        'medicines' => ['name', 'batchNo', 'category', 'stock', 'expiryDate'],
        'notifications' => ['userId', 'read', 'createdAt'],
        'patients' => ['mrn', 'name', 'phone', 'createdAt'],
        'pharmacyOrders' => ['patientId', 'admissionId', 'status', 'createdAt'],
        'purchaseReturns' => ['purchaseId', 'medicineId', 'date', 'createdAt'],
        'purchases' => ['medicineId', 'supplierId', 'date', 'createdAt'],
        'quotations' => ['quotationNo', 'customerId', 'date', 'createdAt'],
        'saleReturns' => ['saleId', 'date', 'createdAt'],
        'sales' => ['customerId', 'patientId', 'date', 'createdAt'],
        'users' => ['username', 'email', 'role'],
    ],
];
