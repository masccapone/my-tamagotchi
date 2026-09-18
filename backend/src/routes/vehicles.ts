import { Router } from "express";
import { buildVehicleReport } from "../services/vehicleReportService";
import { isValidPlateNumber } from "../utils/plate";

export const vehiclesRouter = Router();

vehiclesRouter.get("/:plateNumber", async (req, res, next) => {
  const { plateNumber } = req.params;

  if (!isValidPlateNumber(plateNumber)) {
    return res.status(400).json({
      error: "INVALID_PLATE_NUMBER",
      message: "올바른 차량번호 형식이 아닙니다. 예: 12가3456, 123나4567",
    });
  }

  try {
    const report = await buildVehicleReport(plateNumber);
    res.json(report);
  } catch (error) {
    next(error);
  }
});
