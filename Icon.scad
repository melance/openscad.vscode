
$fn=360;

$vpr = [ 57.80, 0.00, 46.70 ];
$vpt = [ -1.26, 0.26, -0.36 ];
$vpd = 140.00;
$vpf = 22.50;

color("#21a4f1")
difference(){
    sphere(20);
    cylinder(50,r=10,center=true);
    #rotate([90,0,0])
    cylinder(50,r=10,center=true);
    rotate([0,90,0])
    cylinder(50,r=10,center=true);
}