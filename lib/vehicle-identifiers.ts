const VEHICLE_REGION = "(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)";
const VEHICLE_CLASS = "[가나다라마바사아자차카타파하거너더러머버서어저고노도로모보소오조구누두루무부수우주배하허호육해공국합]";

export function vehicleNumberPattern() {
  return new RegExp(
    `(?<![가-힣A-Za-z0-9])(?:${VEHICLE_REGION}\\s*)?\\d{2,3}\\s*${VEHICLE_CLASS}\\s*\\d{4}(?!\\d)`,
    "g",
  );
}

export function maskVehicleNumbers(value: string, replacement = "[차량번호]") {
  return value.replace(vehicleNumberPattern(), replacement);
}
